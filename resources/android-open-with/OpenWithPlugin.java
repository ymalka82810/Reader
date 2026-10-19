package com.yanivm.reader;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Parcelable;
import android.provider.OpenableColumns;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Makes the app show up in the phone's "Open with" list (and the share sheet) for book files, and hands the
 * file that was opened to the JS side.
 *
 * Needs the intent-filters from intent-filters.xml inside MainActivity's <activity> in AndroidManifest.xml
 * (android.yml adds them), and registerPlugin(OpenWithPlugin.class) in MainActivity before super.onCreate().
 *
 * The opened file arrives as a content:// (or file://) URI that only this launch may read, so it is copied into
 * the app's cache right away. The JS reads the copy through Capacitor's local server (convertFileSrc), like the
 * books found on the phone, so the bytes never pass through the bridge as base64.
 *
 * JS: takePending() -> {files: [{path, name}]}: the files opened since the last call (then forgotten).
 */
@CapacitorPlugin(name = "OpenWith")
public class OpenWithPlugin extends Plugin {
    private final List<JSObject> pending = new ArrayList<>();

    @Override
    public void load() {
        if (getActivity() != null) collect(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        collect(intent);
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSArray files = new JSArray();
        synchronized (pending) {
            for (JSObject f : pending) files.put(f);
            pending.clear();
        }
        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }

    private void collect(Intent intent) {
        if (intent == null) return;
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            uris.add(intent.getData());
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri u = streamExtra(intent);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            uris.addAll(streamExtras(intent));
        }
        if (uris.isEmpty()) return;
        // the same intent is delivered again when the activity is recreated: handle it only once
        intent.setAction(null);
        intent.setData(null);
        for (Uri uri : uris) {
            try {
                JSObject f = copy(uri);
                synchronized (pending) {
                    pending.add(f);
                }
            } catch (Exception ignored) {
                // an unreadable file is skipped; the others still open
            }
        }
    }

    @SuppressWarnings("deprecation")
    private Uri streamExtra(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        Parcelable p = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return p instanceof Uri ? (Uri) p : null;
    }

    @SuppressWarnings("deprecation")
    private List<Uri> streamExtras(Intent intent) {
        List<Uri> out = new ArrayList<>();
        ArrayList<Uri> list = Build.VERSION.SDK_INT >= 33
            ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
            : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
        if (list != null) out.addAll(list);
        return out;
    }

    private JSObject copy(Uri uri) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        String name = displayName(resolver, uri);
        File dir = new File(getContext().getCacheDir(), "open-with");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("no cache dir");
        // old copies are not needed once the JS has imported them
        File[] old = dir.listFiles();
        if (old != null) {
            long cutoff = System.currentTimeMillis() - 24L * 60 * 60 * 1000;
            for (File o : old) if (o.lastModified() < cutoff) o.delete();
        }
        File out = new File(dir, System.currentTimeMillis() + "-" + (int) (Math.random() * 1000) + "-" + name.replaceAll("[\\\\/:*?\"<>|]", "_"));
        try (InputStream in = resolver.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new Exception("no stream");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        }
        JSObject f = new JSObject();
        f.put("path", out.getAbsolutePath());
        f.put("name", name);
        return f;
    }

    private String displayName(ContentResolver resolver, Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) name = c.getString(0);
            } catch (Exception ignored) {
                // falls back to the last path segment
            }
        }
        if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
        if (name == null || name.isEmpty()) name = "book";
        int slash = name.lastIndexOf('/');
        return slash >= 0 ? name.substring(slash + 1) : name;
    }
}
