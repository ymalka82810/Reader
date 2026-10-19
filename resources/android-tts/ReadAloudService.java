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
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps the app's process (and the WebView that hands out the sentences) alive and the CPU awake while the book is
 * read aloud, so the reading goes on with the screen off or another app in front. Shows an ongoing notification
 * with a stop button. Started by NativeTtsPlugin.begin, ended by its stop() and when the app is swiped away from
 * the recent apps (the reading lives in the activity's WebView and dies with it).
 */
public class ReadAloudService extends Service {
    private static final String CHANNEL = "read_aloud";
    private static final int NOTIFICATION_ID = 4103;
    private static final long MAX_HOLD_MS = 6L * 60 * 60 * 1000;
    private static final String ACTION_STOP = "com.yanivm.reader.READ_ALOUD_STOP";
    private static final String EXTRA_TITLE = "title";
    private static final String EXTRA_TEXT = "text";
    private static final String EXTRA_STOP = "stop";

    private PowerManager.WakeLock wakeLock;

    static void start(Context ctx, String title, String text, String stop) {
        try {
            Intent i = new Intent(ctx, ReadAloudService.class)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_TEXT, text)
                .putExtra(EXTRA_STOP, stop);
            ContextCompat.startForegroundService(ctx, i);
        } catch (Exception e) {
            // Android refused (the app is not in front): the reading still runs while the app is on the screen
        }
    }

    static void stop(Context ctx) {
        ctx.stopService(new Intent(ctx, ReadAloudService.class));
    }

    private static Notification build(Context ctx, String title, String text, String stop) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Reading aloud", NotificationManager.IMPORTANCE_LOW));
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open != null) {
            b.setContentIntent(PendingIntent.getActivity(ctx, 3, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        Intent halt = new Intent(ctx, ReadAloudService.class).setAction(ACTION_STOP);
        b.addAction(0, stop.isEmpty() ? "Stop" : stop,
            PendingIntent.getService(ctx, 4, halt, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        return b.build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            NativeTtsPlugin.stopFromNotification();
            stopSelf();
            return START_NOT_STICKY;
        }
        String title = intent == null ? null : intent.getStringExtra(EXTRA_TITLE);
        String text = intent == null ? null : intent.getStringExtra(EXTRA_TEXT);
        String stop = intent == null ? null : intent.getStringExtra(EXTRA_STOP);
        // FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK (2): declared for this service in the manifest too
        ServiceCompat.startForeground(this, NOTIFICATION_ID,
            build(this, title == null ? "" : title, text == null ? "" : text, stop == null ? "" : stop), 2);
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "reader:read-aloud");
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
