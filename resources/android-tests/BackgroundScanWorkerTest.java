package com.yanivm.reader;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** What the background scan remembers between runs, in JSON files in the app's private folder. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class BackgroundScanWorkerTest {
    private final Context ctx = RuntimeEnvironment.getApplication();

    @Test
    public void aMissingFileReadsAsEmpty() {
        assertEquals(0, BackgroundScanWorker.readJson(ctx, "missing.json").length());
    }

    @Test
    public void whatWasWrittenReadsBackIncludingHebrew() throws Exception {
        JSONObject data = new JSONObject().put("/storage/ספר.epub", "123:456").put("n", 3);
        BackgroundScanWorker.writeJson(ctx, "known.json", data);
        JSONObject back = BackgroundScanWorker.readJson(ctx, "known.json");
        assertEquals("123:456", back.getString("/storage/ספר.epub"));
        assertEquals(3, back.getInt("n"));
    }

    @Test
    public void aCorruptFileReadsAsEmptyInsteadOfCrashingTheWorker() throws Exception {
        try (FileOutputStream out = new FileOutputStream(new File(ctx.getFilesDir(), "bad.json"))) {
            out.write("{not json".getBytes(StandardCharsets.UTF_8));
        }
        assertEquals(0, BackgroundScanWorker.readJson(ctx, "bad.json").length());
    }

    @Test
    public void writingAgainReplacesTheOldContent() throws Exception {
        BackgroundScanWorker.writeJson(ctx, "r.json", new JSONObject().put("a", 1).put("b", 2));
        BackgroundScanWorker.writeJson(ctx, "r.json", new JSONObject().put("c", 3));
        JSONObject back = BackgroundScanWorker.readJson(ctx, "r.json");
        assertEquals(1, back.length());
        assertTrue(back.has("c"));
    }

    @Test
    public void pruneForgetsOnlyWhatTheLibraryAlreadyKnowsInTheSameState() throws Exception {
        BackgroundScanWorker.writeJson(ctx, "bg_notified.json",
            new JSONObject().put("/a.epub", "1:10").put("/b.epub", "2:20").put("/c.epub", "3:30"));
        // /a is known as announced, /b changed since, /c is not in the library yet
        BackgroundScanWorker.pruneNotified(ctx, new JSONObject().put("/a.epub", "1:10").put("/b.epub", "2:99"));
        JSONObject left = BackgroundScanWorker.readJson(ctx, "bg_notified.json");
        assertFalse(left.has("/a.epub"));
        assertTrue(left.has("/b.epub"));
        assertTrue(left.has("/c.epub"));
    }

    @Test
    public void pruneWithNothingToForgetLeavesTheFileAlone() throws Exception {
        BackgroundScanWorker.writeJson(ctx, "bg_notified.json", new JSONObject().put("/a.epub", "1:10"));
        BackgroundScanWorker.pruneNotified(ctx, new JSONObject());
        assertEquals("1:10", BackgroundScanWorker.readJson(ctx, "bg_notified.json").getString("/a.epub"));
    }
}
