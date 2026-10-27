package com.yanivm.reader;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;

import android.content.pm.PackageInfo;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Random;

/** The checks AppUpdaterPlugin makes around a downloaded update. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class AppUpdaterPluginTest {
    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    private File file(byte[] content) throws Exception {
        File f = tmp.newFile();
        Files.write(f.toPath(), content);
        return f;
    }

    @Test
    public void onlyTheVolumeKeysTurnPages() {
        assertEquals("up", AppUpdaterPlugin.volumeKeyName(android.view.KeyEvent.KEYCODE_VOLUME_UP));
        assertEquals("down", AppUpdaterPlugin.volumeKeyName(android.view.KeyEvent.KEYCODE_VOLUME_DOWN));
        assertNull(AppUpdaterPlugin.volumeKeyName(android.view.KeyEvent.KEYCODE_VOLUME_MUTE));
        assertNull(AppUpdaterPlugin.volumeKeyName(android.view.KeyEvent.KEYCODE_BACK));
    }

    @Test
    public void sha256MatchesTheKnownDigests() throws Exception {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            AppUpdaterPlugin.sha256(file("abc".getBytes(StandardCharsets.UTF_8))));
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            AppUpdaterPlugin.sha256(file(new byte[0])));
    }

    @Test
    public void sha256OfAFileLargerThanTheReadBufferIsComplete() throws Exception {
        byte[] big = new byte[65536 * 3 + 17];
        new Random(7).nextBytes(big);
        StringBuilder expected = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(big)) expected.append(String.format("%02x", b));
        assertEquals(expected.toString(), AppUpdaterPlugin.sha256(file(big)));
    }

    @Test
    public void aChangedByteChangesTheDigest() throws Exception {
        byte[] a = new byte[1000];
        byte[] b = a.clone();
        b[999] = 1;
        assertFalse(AppUpdaterPlugin.sha256(file(a)).equals(AppUpdaterPlugin.sha256(file(b))));
    }

    private static HttpURLConnection connectionWithLength(String header) throws Exception {
        return new HttpURLConnection(new URL("http://localhost/")) {
            @Override public String getHeaderField(String name) { return header; }
            @Override public void disconnect() {}
            @Override public boolean usingProxy() { return false; }
            @Override public void connect() {}
        };
    }

    @Test
    public void contentLengthReadsTheHeaderAndAnswersMinusOneWhenUnknown() throws Exception {
        assertEquals(12345L, AppUpdaterPlugin.contentLength(connectionWithLength("12345")));
        assertEquals(5_000_000_000L, AppUpdaterPlugin.contentLength(connectionWithLength("5000000000")));
        assertEquals(-1L, AppUpdaterPlugin.contentLength(connectionWithLength(null)));
        assertEquals(-1L, AppUpdaterPlugin.contentLength(connectionWithLength("chunked")));
    }

    @Test
    public void versionCodeUsesTheFullLongValue() {
        PackageInfo info = new PackageInfo();
        info.setLongVersionCode(0x1_0000_0007L);
        assertEquals(0x1_0000_0007L, AppUpdaterPlugin.versionCode(info));
        PackageInfo small = new PackageInfo();
        small.setLongVersionCode(42);
        assertEquals(42L, AppUpdaterPlugin.versionCode(small));
    }

    @Test
    public void deleteDirRemovesTheFilesAndTheFolder() throws Exception {
        File dir = tmp.newFolder("app-update");
        new File(dir, "update.apk").createNewFile();
        new File(dir, "partial.tmp").createNewFile();
        AppUpdaterPlugin.deleteDir(dir);
        assertFalse(dir.exists());
    }

    @Test
    public void deleteDirToleratesNullAndAMissingFolder() {
        AppUpdaterPlugin.deleteDir(null);
        File gone = new File(tmp.getRoot(), "never-existed");
        AppUpdaterPlugin.deleteDir(gone);
        assertFalse(gone.exists());
    }
}
