package com.yanivm.reader;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.getcapacitor.JSArray;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;

/**
 * The scan that runs without the app on the screen: every ~15 minutes (WorkManager's minimum) it looks through the
 * same folders as the in-app scan, and when it finds book files the library has not dealt with, it posts ONE
 * notification. It never adds a book: tapping the notification opens the app, which asks first, as always.
 *
 * It stays quiet while the app is in front (the in-app scan covers that), and when the app has no file access or
 * the notifications are off. What the library already knows (`bg_known.json`: path -> "size|modified", pushed by
 * the web side through DeviceBooksPlugin.setBackground) and what was already announced (`bg_notified.json`) are
 * skipped, so each file is announced once.
 */
public class BackgroundScanWorker extends Worker {
    static final String PREFS = "reader_bg_scan";
    static final String CHANNEL = "new_books";
    static final String EXTRA_TAP = "reader_scan_tap";
    private static final int NOTIFICATION_ID = 4101;

    public BackgroundScanWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (!prefs.getBoolean("enabled", false)) return Result.success();
            if (DeviceBooksPlugin.isInForeground()) return Result.success();
            if (!DeviceBooksPlugin.hasAccess(ctx)) return Result.success();
            if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return Result.success();

            JSArray folders = new JSArray(prefs.getString("folders", "[]"));
            JSArray extensions = new JSArray(prefs.getString("extensions", "[]"));
            JSArray files = DeviceBooksPlugin.collect(folders, extensions);

            JSONObject known = readJson(ctx, "bg_known.json");
            JSONObject notified = readJson(ctx, "bg_notified.json");
            int fresh = 0;
            for (int i = 0; i < files.length(); i++) {
                JSONObject f = files.getJSONObject(i);
                String path = f.getString("path");
                String stamp = f.getLong("size") + "|" + f.getLong("modified");
                if (stamp.equals(known.optString(path)) || stamp.equals(notified.optString(path))) continue;
                notified.put(path, stamp);
                fresh++;
            }
            if (fresh == 0) return Result.success();

            notify(ctx, prefs, fresh);
            writeJson(ctx, "bg_notified.json", notified);
        } catch (Throwable e) {
            // a failed round (even out of memory) is simply tried again at the next one
        }
        return Result.success();
    }

    private static void notify(Context ctx, SharedPreferences prefs, int count) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, prefs.getString("channel", "New books"), NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open == null) return;
        open.putExtra(EXTRA_TAP, true);
        PendingIntent tap = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text = count == 1
            ? prefs.getString("textOne", "A new book was found on this phone.")
            : prefs.getString("textMany", "{n} new books were found on this phone.").replace("{n}", String.format(Locale.getDefault(), "%d", count));
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle(prefs.getString("title", "New books found"))
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true);
        NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, b.build());
    }

    static JSONObject readJson(Context ctx, String name) {
        File f = new File(ctx.getFilesDir(), name);
        if (!f.isFile()) return new JSONObject();
        try (FileInputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            for (int n; (n = in.read(chunk)) > 0; ) buf.write(chunk, 0, n);
            return new JSONObject(new String(buf.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static void writeJson(Context ctx, String name, JSONObject data) {
        try (FileOutputStream out = new FileOutputStream(new File(ctx.getFilesDir(), name))) {
            out.write(data.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            // not remembered: at worst the same books are announced once more
        }
    }

    /** what was announced about files the library has meanwhile dealt with is forgotten, so the list stays small */
    static void pruneNotified(Context ctx, JSONObject known) {
        JSONObject notified = readJson(ctx, "bg_notified.json");
        Set<String> drop = new HashSet<>();
        for (Iterator<String> it = notified.keys(); it.hasNext(); ) {
            String path = it.next();
            if (notified.optString(path).equals(known.optString(path))) drop.add(path);
        }
        if (drop.isEmpty()) return;
        for (String path : drop) notified.remove(path);
        writeJson(ctx, "bg_notified.json", notified);
    }
}
