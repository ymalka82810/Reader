package com.yanivm.reader;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps the app's process (and the WebView that runs the import queue) alive while books are being added and the
 * app is not on the screen. The work itself stays in the web app; this service only holds the process, the CPU
 * (partial wake lock) and shows an ongoing notification with the progress. It ends when the queue finishes
 * (DeviceBooksPlugin.stopImportService) and when the app is swiped away from the recent apps, since the queue
 * lives in the activity's WebView and dies with it (what was not added is offered again at the next scan).
 */
public class ImportKeepAliveService extends Service {
    private static final String CHANNEL = "import_progress";
    private static final int NOTIFICATION_ID = 4102;
    private static final long MAX_HOLD_MS = 3L * 60 * 60 * 1000;
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_TEXT = "text";

    private PowerManager.WakeLock wakeLock;

    /** starts the service with its first notification; false when Android refuses (e.g. the app is not in front) */
    static boolean start(Context ctx, String title, String text) {
        try {
            Intent i = new Intent(ctx, ImportKeepAliveService.class).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_TEXT, text);
            ContextCompat.startForegroundService(ctx, i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, ImportKeepAliveService.class));
    }

    /** replaces the notification's texts and progress (total 0 or 1: no bar) */
    static void update(Context ctx, String title, String text, int done, int total) {
        try {
            NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, build(ctx, title, text, done, total));
        } catch (SecurityException e) {
            // notifications switched off: the service keeps running, the notification is simply not shown
        }
    }

    private static Notification build(Context ctx, String title, String text, int done, int total) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Adding books", NotificationManager.IMPORTANCE_LOW));
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true);
        if (total > 1) b.setProgress(total, Math.min(done, total), false);
        else b.setProgress(0, 0, true);
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open != null) {
            b.setContentIntent(PendingIntent.getActivity(ctx, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        return b.build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent == null ? "" : intent.getStringExtra(EXTRA_TITLE);
        String text = intent == null ? "" : intent.getStringExtra(EXTRA_TEXT);
        // FOREGROUND_SERVICE_TYPE_DATA_SYNC (1): declared for this service in the manifest too
        ServiceCompat.startForeground(this, NOTIFICATION_ID, build(this, title == null ? "" : title, text == null ? "" : text, 0, 0), 1);
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "reader:import");
            wakeLock.acquire(MAX_HOLD_MS);
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
