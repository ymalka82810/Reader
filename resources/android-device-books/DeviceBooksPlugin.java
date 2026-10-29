package com.yanivm.reader;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.provider.DocumentsContract;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import android.util.Base64;

import java.io.File;
import java.io.FileOutputStream;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.json.JSONObject;

/**
 * Finds the book files already on the phone (Documents, Download, and folders the user adds), so the library can
 * pick up new ones by itself, like dedicated e-reader apps do.
 *
 * Reading other apps' documents needs "All files access" on Android 11+ (MANAGE_EXTERNAL_STORAGE: the user turns it
 * on in a system screen that requestAccess opens), and READ_EXTERNAL_STORAGE with requestLegacyExternalStorage
 * on Android 10 and older. The JS reads each found file through Capacitor's local server (convertFileSrc), so the
 * book's bytes never pass through the bridge as base64.
 *
 * Needs in AndroidManifest.xml: FOREGROUND_SERVICE, FOREGROUND_SERVICE_DATA_SYNC, WAKE_LOCK, the ImportKeepAliveService
 * <service> (foregroundServiceType="dataSync"), POST_NOTIFICATIONS, MANAGE_EXTERNAL_STORAGE, READ_EXTERNAL_STORAGE (maxSdkVersion 32) and
 * android:requestLegacyExternalStorage="true" on <application>.
 * Needs in app/build.gradle: androidx.work:work-runtime.
 * Register it in MainActivity: registerPlugin(DeviceBooksPlugin.class) before super.onCreate().
 *
 * JS: status() -> {granted}
 *     requestAccess() -> {granted} once the user is back from the system screen or permission dialog
 *     scan({folders, extensions}) -> {files: [{path, name, size, modified}]}; folders are relative to the shared
 *       storage root ("Documents", "Download", "Books/Hebrew"); rejects with "permission" without access
 *     refreshIndex({paths}) -> {}: tells the system's media index about these files (their current names, also the name and
 *       title stored in their index rows, which Drive and share sheets show) and drops entries of files that are gone (in the
 *       folders of these files), so the names a file manager shows are the real ones; never rejects
 *     rename({path, name}) -> {path, name, size, modified}: renames a file in the shared storage (a name already taken gets " (2)");
 *       rejects with "permission", "missing" (no such file), "outside" or "rename"
 *     save({name, data}) -> {path, name, size, modified}: starts a new file in the Download folder from base64 `data`
 *       (a name already taken gets " (2)"); save({path, data}) appends the next piece to it. Rejects with "permission"
 *       or "save"
 *     setBackground({enabled, folders, extensions, known, title, textOne, textMany, channel}) -> {}: turns the scan that
 *       runs without the app on the screen on or off (BackgroundScanWorker, every ~15 minutes, even when the app is
 *       closed). `known` is {path: "size|modified"} of what the library already dealt with; the texts are the
 *       notification's, in the app's language
 *     notificationStatus() / requestNotifications() -> {granted}: Android 13+ asks for the notification permission
 *     consumeNotificationTap() -> {tapped}: true once after the app was opened from the "new books" notification
 *     startImportService({title, text}) -> {started}: holds the app alive (foreground service, ongoing notification,
 *       partial wake lock) while the import queue runs with the app not on the screen
 *     updateImportService({title, text, done, total}) -> {}: the notification's texts and progress bar
 *     stopImportService() -> {}: the queue is finished or cancelled
 *     shareStage({name, data, reset?}) / shareStage({path, data}) -> {path, name}: stages a file to share in the app's cache
 *     share({paths, title}) -> {}: the phone's share sheet for staged files or book files in the shared storage; rejects
 *       with "missing" (nothing opened) or "share". Needs a FileProvider "${applicationId}.fileprovider" whose paths include
 *       <cache-path path="share/" /> and <external-path path="." />
 *     pickFolder() -> {folder?} relative to the root (absent when cancelled); rejects with "not local" for a folder
 *       outside the phone's own storage (SD card, cloud), or "no picker"
 */
@CapacitorPlugin(
    name = "DeviceBooks",
    permissions = {
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
    }
)
public class DeviceBooksPlugin extends Plugin {
    private static final int MAX_DEPTH = 8;
    private static final int MAX_FILES = 5000;

    /** true while the app's screen is in front; the background scan stays quiet then */
    private static volatile boolean foreground = false;
    /** the app was opened from the "new books" notification and the web side has not asked about it yet */
    private static volatile boolean tapped = false;

    static boolean isInForeground() {
        return foreground;
    }

    static boolean hasAccess(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return Environment.isExternalStorageManager();
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.READ_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasAccess() {
        return hasAccess(getContext());
    }

    @Override
    public void load() {
        noteTap(getActivity() == null ? null : getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        noteTap(intent);
    }

    @Override
    protected void handleOnResume() {
        foreground = true;
    }

    @Override
    protected void handleOnPause() {
        foreground = false;
        keepWebViewRunning();
    }

    @Override
    protected void handleOnStop() {
        keepWebViewRunning();
    }

    /** an import queue is running under ImportKeepAliveService */
    private static volatile boolean importing = false;

    /**
     * Chromium treats a WebView whose window is hidden as a background page and slows its timers right down. While
     * the import queue runs with the app not on the screen, tell the WebView its window is still visible (the same
     * trick cordova-plugin-background-mode uses), so the queue is not throttled.
     */
    private void keepWebViewRunning() {
        if (!importing || getBridge() == null || getActivity() == null) return;
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (importing && getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().dispatchWindowVisibilityChanged(View.VISIBLE);
            }
        }, 1000);
    }

    private static void noteTap(Intent intent) {
        if (intent != null && intent.getBooleanExtra(BackgroundScanWorker.EXTRA_TAP, false)) {
            tapped = true;
            intent.removeExtra(BackgroundScanWorker.EXTRA_TAP);
        }
    }

    private void resolveStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasAccess());
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        resolveStatus(call);
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        if (hasAccess()) {
            resolveStatus(call);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Intent own = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            try {
                startActivityForResult(call, own, "accessResult");
            } catch (ActivityNotFoundException e) {
                // some vendors only have the list of all apps
                try {
                    startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION), "accessResult");
                } catch (ActivityNotFoundException e2) {
                    call.reject("no settings");
                }
            }
        } else {
            requestPermissionForAlias("storage", call, "storageResult");
        }
    }

    @ActivityCallback
    private void accessResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        resolveStatus(call); // the settings screen always answers "cancelled": ask the system instead
    }

    @PermissionCallback
    private void storageResult(PluginCall call) {
        resolveStatus(call);
    }

    @PluginMethod
    public void scan(PluginCall call) {
        if (!hasAccess()) {
            call.reject("permission");
            return;
        }
        JSArray folders = call.getArray("folders", new JSArray());
        JSArray extensions = call.getArray("extensions", new JSArray());
        new Thread(() -> {
            try {
                JSObject ret = new JSObject();
                ret.put("files", collect(folders, extensions));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("scan", e);
            }
        }).start();
    }

    /** the matching book files in the given folders (relative to the shared storage root); also used by the background scan */
    static JSArray collect(JSArray folders, JSArray extensions) throws Exception {
        Set<String> exts = new HashSet<>();
        for (int i = 0; i < extensions.length(); i++) exts.add(extensions.getString(i).toLowerCase(Locale.ROOT));
        File root = Environment.getExternalStorageDirectory();
        String rootPath = root.getCanonicalPath();
        JSArray files = new JSArray();
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < folders.length(); i++) {
            walk(new File(root, folders.getString(i)), rootPath, exts, files, seen, 0);
        }
        return files;
    }

    /** collects the matching files under dir; `seen` keeps overlapping folders (Documents and Documents/Books) from listing a file twice */
    private static void walk(File dir, String rootPath, Set<String> exts, JSArray out, Set<String> seen, int depth) throws Exception {
        if (depth > MAX_DEPTH || out.length() >= MAX_FILES || !dir.isDirectory()) return;
        String path = dir.getCanonicalPath();
        // stay inside the shared storage, never in other apps' private folders, and never loop through a link
        if (!(path.equals(rootPath) || path.startsWith(rootPath + "/"))) return;
        if (path.equals(rootPath + "/Android") || !seen.add(path)) return;
        File[] list = dir.listFiles();
        if (list == null) return;
        for (File f : list) {
            String name = f.getName();
            if (name.startsWith(".")) continue;
            if (f.isDirectory()) {
                walk(f, rootPath, exts, out, seen, depth + 1);
                continue;
            }
            int dot = name.lastIndexOf('.');
            if (dot < 0 || !exts.contains(name.substring(dot + 1).toLowerCase(Locale.ROOT))) continue;
            if (!f.isFile() || !seen.add(f.getCanonicalPath())) continue;
            JSObject o = new JSObject();
            o.put("path", f.getAbsolutePath());
            o.put("name", name);
            o.put("size", f.length());
            o.put("modified", f.lastModified());
            out.put(o);
            if (out.length() >= MAX_FILES) return;
        }
    }

    /** a file name that cannot climb out of its folder or hide */
    static String cleanName(String name) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        while (n.startsWith(".")) n = n.substring(1);
        return n;
    }

    /** `name` in `dir`, or "name (2).ext", "name (3).ext"… when that is taken (`self` itself never counts as taken) */
    static File freeFile(File dir, String name, File self) {
        File f = new File(dir, name);
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 2; f.exists() && !f.equals(self); i++) f = new File(dir, stem + " (" + i + ")" + ext);
        return f;
    }

    /** the app's own books folder, in the phone's Documents (a scanned folder, so every book there is already known) */
    static final String LIBRARY_DIR = "קורא ספרים";

    static File libraryRoot() {
        return new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), LIBRARY_DIR);
    }

    /** the books folder, or the sub-folder `dir` inside it; each segment is cleaned so it cannot climb out */
    static File libraryDir(String dir) {
        File d = libraryRoot();
        if (dir == null) return d;
        for (String seg : dir.split("/")) {
            String n = cleanName(seg);
            if (!n.isEmpty()) d = new File(d, n);
        }
        return d;
    }

    private static boolean inside(File f, File dir) throws Exception {
        return f.getCanonicalPath().startsWith(dir.getCanonicalPath() + "/");
    }

    /** empty folders left behind by a moved book go too, but never the books folder itself */
    private static void pruneEmpty(File dir) {
        try {
            File root = libraryRoot().getCanonicalFile();
            File d = dir.getCanonicalFile();
            while (!d.equals(root) && d.getPath().startsWith(root.getPath() + "/")) {
                String[] left = d.list();
                if (left == null || left.length > 0 || !d.delete()) return;
                d = d.getParentFile();
            }
        } catch (Exception ignored) {
        }
    }

    /** removes every empty sub-folder of the books folder (deepest first), never the books folder itself */
    private static int pruneTree(File dir) {
        int removed = 0;
        File[] list = dir.listFiles();
        if (list == null) return 0;
        for (File f : list) {
            if (!f.isDirectory()) continue;
            removed += pruneTree(f);
            String[] left = f.list();
            if (left != null && left.length == 0 && f.delete()) removed++;
        }
        return removed;
    }

    @PluginMethod
    public void pruneEmptyFolders(PluginCall call) {
        if (!hasAccess()) {
            call.reject("permission");
            return;
        }
        try {
            File root = libraryRoot();
            JSObject ret = new JSObject();
            ret.put("removed", root.isDirectory() ? pruneTree(root) : 0);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("prune", e);
        }
    }

    private boolean insideStorage(File f) throws Exception {
        String rootPath = Environment.getExternalStorageDirectory().getCanonicalPath();
        String p = f.getCanonicalPath();
        return p.startsWith(rootPath + "/") && !p.startsWith(rootPath + "/Android/");
    }

    /** After a file was renamed or moved: the media index (what Drive, the share sheet and file pickers read the name from)
     *  still holds a row under the OLD path with the OLD name, which shows up as the file's name (often a string of letters
     *  and digits from wherever it was downloaded). The old row is deleted by path (its file is gone, so nothing on disk is
     *  touched), the new path is scanned, and the new row's name and title are set to the file's current name. Quiet. */
    private void reindexRenamed(File from, File to) {
        final android.content.ContentResolver cr = getContext().getContentResolver();
        final Uri files = android.provider.MediaStore.Files.getContentUri("external");
        if (!from.equals(to) && !from.exists()) {
            try {
                cr.delete(files, android.provider.MediaStore.Files.FileColumns.DATA + "=?", new String[] { from.getAbsolutePath() });
            } catch (Exception ignored) {
            }
        }
        // the row of the file itself may hold a stale name (a string of letters and digits) that an update cannot change, as
        // the row was made by another app: drop it, the scan below makes a fresh one named after the file
        try {
            cr.delete(files, android.provider.MediaStore.Files.FileColumns.DATA + "=?", new String[] { to.getAbsolutePath() });
        } catch (Exception ignored) {
        }
        final String fileName = to.getName();
        final int dot = fileName.lastIndexOf('.');
        final String stem = dot > 0 ? fileName.substring(0, dot) : fileName;
        MediaScannerConnection.scanFile(getContext(), new String[] { to.getAbsolutePath() }, null,
                new MediaScannerConnection.OnScanCompletedListener() {
                    @Override
                    public void onScanCompleted(String path, Uri uri) {
                        if (uri == null) return;
                        try {
                            android.content.ContentValues v = new android.content.ContentValues();
                            v.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                            v.put(android.provider.MediaStore.MediaColumns.TITLE, stem);
                            cr.update(uri, v, null, null);
                        } catch (Exception ignored) {
                        }
                    }
                });
    }

    @PluginMethod
    public void refreshIndex(PluginCall call) {
        try {
            JSArray list = call.getArray("paths");
            java.util.Set<String> paths = new java.util.LinkedHashSet<>();
            java.util.Set<String> dirs = new java.util.LinkedHashSet<>();
            if (list != null) {
                for (int i = 0; i < list.length(); i++) {
                    String p = list.optString(i, "");
                    File f = new File(p);
                    if (!p.isEmpty() && f.isFile()) {
                        paths.add(p);
                        if (f.getParent() != null) dirs.add(f.getParent());
                    }
                }
            }
            // names a file used to have are not known, but the index still lists them: in these folders, entries whose file is
            // gone are scanned too, which makes the system drop them
            for (String dir : dirs) {
                try (android.database.Cursor c = getContext().getContentResolver().query(
                        android.provider.MediaStore.Files.getContentUri("external"),
                        new String[] { android.provider.MediaStore.Files.FileColumns.DATA },
                        android.provider.MediaStore.Files.FileColumns.DATA + " LIKE ?",
                        new String[] { dir + "/%" },
                        null)) {
                    while (c != null && c.moveToNext()) {
                        String p = c.getString(0);
                        if (p != null && !new File(p).exists()) {
                            paths.add(p);
                            try {
                                getContext().getContentResolver().delete(
                                        android.provider.MediaStore.Files.getContentUri("external"),
                                        android.provider.MediaStore.Files.FileColumns.DATA + "=?", new String[] { p });
                            } catch (Exception ignored) {
                            }
                        }
                    }
                } catch (Exception ignored) {
                }
            }
            for (String p : paths) {
                File f = new File(p);
                if (f.isFile()) reindexRenamed(f, f);
            }
            if (!paths.isEmpty()) MediaScannerConnection.scanFile(getContext(), paths.toArray(new String[0]), null, null);
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    @PluginMethod
    public void rename(PluginCall call) {
        if (!hasAccess()) {
            call.reject("permission");
            return;
        }
        try {
            File from = new File(call.getString("path", ""));
            String name = cleanName(call.getString("name"));
            if (name.isEmpty()) {
                call.reject("rename");
                return;
            }
            if (!insideStorage(from)) {
                call.reject("outside");
                return;
            }
            if (!from.isFile()) {
                call.reject("missing");
                return;
            }
            File to = freeFile(from.getParentFile(), name, from);
            if (!to.equals(from)) {
                if (!from.renameTo(to)) {
                    call.reject("rename");
                    return;
                }
                // the system's media index still holds the old name: drop it and add the new one, so the file manager
                // and other readers show the new name at once
                reindexRenamed(from, to);
            }
            JSObject ret = new JSObject();
            ret.put("path", to.getAbsolutePath());
            ret.put("name", to.getName());
            ret.put("size", to.length());
            ret.put("modified", to.lastModified());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("rename", e);
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        if (!hasAccess()) {
            call.reject("permission");
            return;
        }
        try {
            String data = call.getString("data", "");
            String path = call.getString("path");
            File f;
            boolean append = path != null;
            if (append) {
                f = new File(path);
                // only a file this method started: inside the Download folder or the books folder
                File dl = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!(inside(f, dl) || inside(f, libraryRoot())) || !f.isFile()) {
                    call.reject("save");
                    return;
                }
            } else {
                String name = cleanName(call.getString("name"));
                if (name.isEmpty()) {
                    call.reject("save");
                    return;
                }
                String sub = call.getString("dir");
                File dl = sub == null ? Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS) : libraryDir(sub);
                //noinspection ResultOfMethodCallIgnored
                dl.mkdirs();
                f = freeFile(dl, name, null);
            }
            try (FileOutputStream out = new FileOutputStream(f, append)) {
                out.write(Base64.decode(data, Base64.DEFAULT));
            }
            JSObject ret = new JSObject();
            ret.put("path", f.getAbsolutePath());
            ret.put("name", f.getName());
            ret.put("size", f.length());
            ret.put("modified", f.lastModified());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("save", e);
        }
    }

    /** Moves a book's file on the phone into the books folder, into the sub-folder `dir` (the book's folder in the library),
     *  under `name`. A file already there stays; a taken name gets " (2)". Folders left empty are removed. */
    @PluginMethod
    public void place(PluginCall call) {
        if (!hasAccess()) {
            call.reject("permission");
            return;
        }
        try {
            File from = new File(call.getString("path", ""));
            String name = cleanName(call.getString("name"));
            if (name.isEmpty()) {
                call.reject("place");
                return;
            }
            if (!insideStorage(from)) {
                call.reject("outside");
                return;
            }
            if (!from.isFile()) {
                call.reject("missing");
                return;
            }
            File dir = libraryDir(call.getString("dir"));
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File to = freeFile(dir, name, from);
            if (!to.equals(from)) {
                if (!from.renameTo(to)) {
                    // another volume or a refused rename: copy, then remove the original only once the copy is whole
                    try (java.io.InputStream in = new java.io.FileInputStream(from);
                         FileOutputStream out = new FileOutputStream(to)) {
                        byte[] buf = new byte[64 * 1024];
                        int n;
                        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    }
                    boolean whole = to.length() == from.length();
                    if (!whole || !from.delete()) {
                        // a half copy, or an original that would not go: leave one file only, the original
                        //noinspection ResultOfMethodCallIgnored
                        to.delete();
                        call.reject("place");
                        return;
                    }
                }
                reindexRenamed(from, to);
                pruneEmpty(from.getParentFile());
            }
            JSObject ret = new JSObject();
            ret.put("path", to.getAbsolutePath());
            ret.put("name", to.getName());
            ret.put("size", to.length());
            ret.put("modified", to.lastModified());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("place", e);
        }
    }

    /** the formats the app reads as books: the only files the app may delete (a surplus copy the user approved, or the PDF a
     *  converted EPUB replaced) */
    static boolean isBookFile(File f) {
        String n = f.getName().toLowerCase(java.util.Locale.ROOT);
        for (String ext : new String[] { ".epub", ".pdf", ".mobi", ".azw", ".azw3", ".fb2", ".cbz", ".cbr" }) if (n.endsWith(ext)) return true;
        return false;
    }

    /** Deletes a book file on the phone: only a book format (EPUB, PDF, MOBI…) inside the phone's own storage, never another
     *  app's folder; folders left empty in the books folder go too. */
    @PluginMethod
    public void remove(PluginCall call) {
        if (!hasAccess()) {
            call.reject("permission");
            return;
        }
        try {
            File f = new File(call.getString("path", ""));
            if (!insideStorage(f) || !isBookFile(f) || !f.isFile() || !f.delete()) {
                call.reject("remove");
                return;
            }
            MediaScannerConnection.scanFile(getContext(), new String[] { f.getAbsolutePath() }, null, null);
            pruneEmpty(f.getParentFile());
            call.resolve();
        } catch (Exception e) {
            call.reject("remove", e);
        }
    }

    @PluginMethod
    public void openDownloads(PluginCall call) {
        try {
            Intent i = new Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            // no Downloads app: the system file picker, opened on the Download folder, does as well
            try {
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.setType("*/*");
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(Intent.createChooser(i, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                call.resolve();
            } catch (Exception e2) {
                call.reject("open", e2);
            }
        }
    }

    /** Tells the system a file was added, so the Downloads app and the file managers list it at once (a file written
     *  straight into the Download folder is otherwise unknown to them until something rescans). scanFile({path}) -> {}. */
    @PluginMethod
    public void scanFile(PluginCall call) {
        try {
            File f = new File(call.getString("path", ""));
            if (!f.isFile() || !insideStorage(f)) {
                call.reject("scan");
                return;
            }
            android.media.MediaScannerConnection.scanFile(getContext(), new String[] {f.getAbsolutePath()}, null, null);
            call.resolve();
        } catch (Exception e) {
            call.reject("scan", e);
        }
    }

    /** where the files of a share wait for the app they are sent to (the app's own cache: needs no storage permission) */
    private File shareDir() {
        return new File(getContext().getCacheDir(), "share");
    }

    /** Stages a file to share from base64 `data`: shareStage({name, data, reset?}) starts a new file in the share folder
     *  (`reset` first clears the files of the previous share; a name already taken gets " (2)"), shareStage({path, data})
     *  appends the next piece to it. Rejects with "save". */
    @PluginMethod
    public void shareStage(PluginCall call) {
        try {
            File dir = shareDir();
            String path = call.getString("path");
            File f;
            boolean append = path != null;
            if (append) {
                f = new File(path);
                if (!inside(f, dir) || !f.isFile()) {
                    call.reject("save");
                    return;
                }
            } else {
                if (Boolean.TRUE.equals(call.getBoolean("reset", false))) clearDir(dir);
                String name = cleanName(call.getString("name"));
                if (name.isEmpty()) {
                    call.reject("save");
                    return;
                }
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                f = freeFile(dir, name, null);
            }
            try (FileOutputStream out = new FileOutputStream(f, append)) {
                out.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            }
            JSObject ret = new JSObject();
            ret.put("path", f.getAbsolutePath());
            ret.put("name", f.getName());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("save", e);
        }
    }

    private static void clearDir(File dir) {
        File[] old = dir.listFiles();
        if (old == null) return;
        for (File o : old) {
            //noinspection ResultOfMethodCallIgnored
            o.delete();
        }
    }

    /** the type the share sheet is told: one type for files of one format, else any file */
    static String shareType(java.util.List<File> files) {
        String type = null;
        for (File f : files) {
            String n = f.getName().toLowerCase(Locale.ROOT);
            int dot = n.lastIndexOf('.');
            String ext = dot >= 0 ? n.substring(dot + 1) : "";
            String t;
            switch (ext) {
                case "epub": t = "application/epub+zip"; break;
                case "pdf": t = "application/pdf"; break;
                case "docx": t = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; break;
                case "txt": t = "text/plain"; break;
                case "html": case "htm": t = "text/html"; break;
                case "mobi": t = "application/x-mobipocket-ebook"; break;
                case "fb2": t = "application/x-fictionbook+xml"; break;
                case "cbz": t = "application/vnd.comicbook+zip"; break;
                case "cbr": t = "application/vnd.comicbook-rar"; break;
                case "m4b": t = "audio/mp4"; break;
                case "mp3": t = "audio/mpeg"; break;
                default: t = "application/octet-stream";
            }
            if (type == null) type = t;
            else if (!type.equals(t)) return "*/*";
        }
        return type == null ? "*/*" : type;
    }

    /** Opens the phone's share sheet for these files: ones staged by shareStage, or book files in the phone's own storage
     *  (a book's own file, shared as it is with no copy). share({paths, title}) -> {} once the sheet is up; rejects with
     *  "missing" (a file is gone: nothing is opened, so the caller can stage it instead) or "share". */
    @PluginMethod
    public void share(PluginCall call) {
        try {
            JSArray paths = call.getArray("paths");
            if (paths == null || paths.length() == 0) {
                call.reject("share");
                return;
            }
            java.util.ArrayList<File> files = new java.util.ArrayList<>();
            for (int i = 0; i < paths.length(); i++) {
                File f = new File(paths.getString(i));
                boolean ok = inside(f, shareDir()) || (hasAccess() && insideStorage(f));
                if (!ok || !f.isFile()) {
                    call.reject("missing");
                    return;
                }
                files.add(f);
            }
            String authority = getContext().getPackageName() + ".fileprovider";
            java.util.ArrayList<Uri> uris = new java.util.ArrayList<>();
            try {
                for (File f : files) uris.add(androidx.core.content.FileProvider.getUriForFile(getContext(), authority, f));
            } catch (IllegalArgumentException e) {
                // a file outside every FileProvider root (an SD card, say): the caller copies it into the cache and shares that
                call.reject("missing");
                return;
            }
            Intent send;
            if (uris.size() == 1) {
                send = new Intent(Intent.ACTION_SEND);
                send.putExtra(Intent.EXTRA_STREAM, uris.get(0));
            } else {
                send = new Intent(Intent.ACTION_SEND_MULTIPLE);
                send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            }
            send.setType(shareType(files));
            String title = call.getString("title");
            if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
            // the receiving app reads every file: each one is in the clip, so the read grant covers all of them
            android.content.ClipData clip = android.content.ClipData.newRawUri(files.get(0).getName(), uris.get(0));
            for (int i = 1; i < uris.size(); i++) clip.addItem(new android.content.ClipData.Item(uris.get(i)));
            send.setClipData(clip);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Activity act = getActivity();
            if (act != null) act.startActivity(chooser);
            else {
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(chooser);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("share", e);
        }
    }

    private boolean notificationsOn() {
        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
    }

    private void resolveNotifications(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", notificationsOn());
        call.resolve(ret);
    }

    @PluginMethod
    public void notificationStatus(PluginCall call) {
        resolveNotifications(call);
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        // before Android 13 notifications need no permission (the user can still switch them off in the system settings)
        if (Build.VERSION.SDK_INT >= 33 && !notificationsOn()) requestPermissionForAlias("notifications", call, "notificationsResult");
        else resolveNotifications(call);
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        resolveNotifications(call);
    }

    @PluginMethod
    public void consumeNotificationTap(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("tapped", tapped);
        tapped = false;
        call.resolve(ret);
    }

    @PluginMethod
    public void setBackground(PluginCall call) {
        Context ctx = getContext();
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        SharedPreferences.Editor prefs = ctx.getSharedPreferences(BackgroundScanWorker.PREFS, Context.MODE_PRIVATE).edit();
        prefs.putBoolean("enabled", enabled);
        WorkManager work = WorkManager.getInstance(ctx);
        if (enabled) {
            prefs.putString("folders", call.getArray("folders", new JSArray()).toString());
            prefs.putString("extensions", call.getArray("extensions", new JSArray()).toString());
            prefs.putString("title", call.getString("title", "New books found"));
            prefs.putString("textOne", call.getString("textOne", "A new book was found on this phone."));
            prefs.putString("textMany", call.getString("textMany", "{n} new books were found on this phone."));
            prefs.putString("channel", call.getString("channel", "New books"));
            JSONObject known = call.getObject("known", new JSObject());
            BackgroundScanWorker.writeJson(ctx, "bg_known.json", known);
            BackgroundScanWorker.pruneNotified(ctx, known);
            // KEEP: syncing again must not push the next round back each time
            work.enqueueUniquePeriodicWork("device-book-scan", ExistingPeriodicWorkPolicy.KEEP,
                new PeriodicWorkRequest.Builder(BackgroundScanWorker.class, 15, TimeUnit.MINUTES).build());
        } else {
            work.cancelUniqueWork("device-book-scan");
        }
        prefs.apply();
        call.resolve();
    }

    @PluginMethod
    public void startImportService(PluginCall call) {
        boolean started = ImportKeepAliveService.start(getContext(), call.getString("title", ""), call.getString("text", ""));
        importing = started;
        JSObject ret = new JSObject();
        ret.put("started", started);
        call.resolve(ret);
    }

    @PluginMethod
    public void updateImportService(PluginCall call) {
        ImportKeepAliveService.update(getContext(), call.getString("title", ""), call.getString("text", ""),
            call.getInt("done", 0), call.getInt("total", 0));
        call.resolve();
    }

    @PluginMethod
    public void stopImportService(PluginCall call) {
        importing = false;
        ImportKeepAliveService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void pickFolder(PluginCall call) {
        try {
            startActivityForResult(call, new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), "folderResult");
        } catch (ActivityNotFoundException e) {
            call.reject("no picker");
        }
    }

    @ActivityCallback
    private void folderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(ret);
            return;
        }
        String folder = null;
        try {
            String id = DocumentsContract.getTreeDocumentId(data.getData());
            String rootPath = Environment.getExternalStorageDirectory().getCanonicalPath();
            if (id != null && id.startsWith("primary:")) {
                // the phone's own storage: "primary:Books/Hebrew"
                folder = id.substring("primary:".length());
            } else if (id != null && id.startsWith("raw:")) {
                // the Downloads app hands out real paths: "raw:/storage/emulated/0/Download/Books"
                String p = new File(id.substring("raw:".length())).getCanonicalPath();
                if (p.equals(rootPath)) folder = "";
                else if (p.startsWith(rootPath + "/")) folder = p.substring(rootPath.length() + 1);
            }
        } catch (Exception e) {
            folder = null;
        }
        if (folder == null) {
            call.reject("not local");
            return;
        }
        ret.put("folder", folder);
        call.resolve(ret);
    }
}
