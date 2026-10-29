package com.yanivm.reader;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.os.Environment;

import com.getcapacitor.JSArray;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Set;
import java.util.TreeSet;

/** The scan of the phone's shared storage and the file-name rules of DeviceBooksPlugin. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class DeviceBooksPluginTest {
    private File root;

    @Before
    public void setUp() {
        root = Environment.getExternalStorageDirectory();
        root.mkdirs();
    }

    private File touch(String relative) throws IOException {
        File f = new File(root, relative);
        f.getParentFile().mkdirs();
        assertTrue(f.createNewFile() || f.exists());
        return f;
    }

    private static JSArray array(String... values) {
        JSArray a = new JSArray();
        for (String v : values) a.put(v);
        return a;
    }

    private static Set<String> set(String... values) {
        return new TreeSet<>(Arrays.asList(values));
    }

    /** the paths found, relative to the storage root */
    private Set<String> collected(JSArray folders, String... extensions) throws Exception {
        JSArray files = DeviceBooksPlugin.collect(folders, array(extensions));
        Set<String> out = new TreeSet<>();
        String prefix = root.getCanonicalPath() + "/";
        for (int i = 0; i < files.length(); i++) {
            String path = new File(files.getJSONObject(i).getString("path")).getCanonicalPath();
            out.add(path.substring(prefix.length()));
        }
        return out;
    }

    @Test
    public void findsOnlyTheRequestedExtensionsRegardlessOfCase() throws Exception {
        touch("Books/a.epub");
        touch("Books/B.EPUB");
        touch("Books/c.pdf");
        touch("Books/d.jpg");
        touch("Books/noextension");
        assertEquals(set("Books/a.epub", "Books/B.EPUB", "Books/c.pdf"), collected(array("Books"), "epub", "pdf"));
    }

    @Test
    public void reportsNameAndSizeOfEachFile() throws Exception {
        File f = touch("Books/דוגמה.epub");
        Files.write(f.toPath(), new byte[1234]);
        JSArray files = DeviceBooksPlugin.collect(array("Books"), array("epub"));
        assertEquals(1, files.length());
        assertEquals("דוגמה.epub", files.getJSONObject(0).getString("name"));
        assertEquals(1234, files.getJSONObject(0).getLong("size"));
    }

    @Test
    public void goesIntoSubfoldersButSkipsHiddenOnes() throws Exception {
        touch("Books/sub/deeper/a.epub");
        touch("Books/.hidden/b.epub");
        touch("Books/.c.epub");
        assertEquals(set("Books/sub/deeper/a.epub"), collected(array("Books"), "epub"));
    }

    @Test
    public void neverEntersOtherAppsFolders() throws Exception {
        touch("Android/data/com.other/files/x.epub");
        touch("Documents/ok.epub");
        // the root itself is scanned, and Android/ is still left out
        assertEquals(set("Documents/ok.epub"), collected(array(""), "epub"));
    }

    @Test
    public void sharedMediaFoldersCanBeTidiedButOtherAppsPrivateOnesCannot() throws Exception {
        assertTrue(DeviceBooksPlugin.insideStorage(new File(root, "Android/media/org.telegram.messenger/Telegram/Telegram Documents/a.epub"), root));
        assertTrue(DeviceBooksPlugin.insideStorage(new File(root, "Download/a.epub"), root));
        assertFalse(DeviceBooksPlugin.insideStorage(new File(root, "Android/data/com.other/files/x.epub"), root));
        assertFalse(DeviceBooksPlugin.insideStorage(new File(root, "Android/obb/com.other/x.epub"), root));
        assertFalse(DeviceBooksPlugin.insideStorage(new File(root.getParentFile(), "elsewhere/x.epub"), root));
    }

    @Test
    public void aFolderOutsideTheStorageIsIgnored() throws Exception {
        File outside = new File(root.getParentFile(), "outside-" + System.nanoTime());
        outside.mkdirs();
        new File(outside, "secret.epub").createNewFile();
        assertTrue(collected(array("../" + outside.getName()), "epub").isEmpty());
    }

    @Test
    public void overlappingFoldersListAFileOnce() throws Exception {
        touch("Documents/Books/a.epub");
        assertEquals(1, DeviceBooksPlugin.collect(array("Documents", "Documents/Books"), array("epub")).length());
    }

    @Test
    public void aMissingFolderIsNotAnError() throws Exception {
        assertTrue(collected(array("NoSuchFolder"), "epub").isEmpty());
    }

    @Test
    public void stopsAtTheDepthLimit() throws Exception {
        // the folder itself is depth 0: eight levels below it are scanned, a ninth is not
        touch("Deep/1/2/3/4/5/6/7/8/in.epub");
        touch("Deep/1/2/3/4/5/6/7/8/9/out.epub");
        Set<String> found = collected(array("Deep"), "epub");
        assertTrue(found.contains("Deep/1/2/3/4/5/6/7/8/in.epub"));
        assertFalse(found.contains("Deep/1/2/3/4/5/6/7/8/9/out.epub"));
    }

    @Test
    public void aLinkBackToAParentFolderDoesNotLoop() throws Exception {
        touch("Loop/a.epub");
        try {
            Files.createSymbolicLink(new File(root, "Loop/back").toPath(), new File(root, "Loop").toPath());
        } catch (UnsupportedOperationException | IOException e) {
            return; // no links on this file system
        }
        assertEquals(set("Loop/a.epub"), collected(array("Loop"), "epub"));
    }

    @Test
    public void cleanNameRemovesWhatCouldClimbOutOfTheFolderOrHide() {
        assertEquals("", DeviceBooksPlugin.cleanName(null));
        assertEquals("book.epub", DeviceBooksPlugin.cleanName("  book.epub  "));
        assertEquals("hidden.epub", DeviceBooksPlugin.cleanName(".hidden.epub"));
        assertEquals("", DeviceBooksPlugin.cleanName("..."));
        assertEquals("a_b_c_d.epub", DeviceBooksPlugin.cleanName("a:b*c?d.epub"));
        String climbing = DeviceBooksPlugin.cleanName("../../etc/passwd");
        assertFalse(climbing.contains("/"));
        assertFalse(climbing.startsWith("."));
        assertEquals("a_b.epub", DeviceBooksPlugin.cleanName("a\\b.epub"));
        assertEquals("שלום עולם.epub", DeviceBooksPlugin.cleanName("שלום עולם.epub"));
    }

    @Test
    public void freeFileNumbersANameThatIsTaken() throws Exception {
        File dir = new File(root, "Free");
        dir.mkdirs();
        assertEquals("a.epub", DeviceBooksPlugin.freeFile(dir, "a.epub", null).getName());
        new File(dir, "a.epub").createNewFile();
        assertEquals("a (2).epub", DeviceBooksPlugin.freeFile(dir, "a.epub", null).getName());
        new File(dir, "a (2).epub").createNewFile();
        assertEquals("a (3).epub", DeviceBooksPlugin.freeFile(dir, "a.epub", null).getName());
    }

    @Test
    public void freeFileKeepsTheNameWhenTheFileIsItself() throws Exception {
        File dir = new File(root, "Self");
        dir.mkdirs();
        File same = new File(dir, "a.epub");
        same.createNewFile();
        assertEquals(same, DeviceBooksPlugin.freeFile(dir, "a.epub", same));
    }

    @Test
    public void freeFileHandlesANameWithoutAnExtension() throws Exception {
        File dir = new File(root, "NoExt");
        dir.mkdirs();
        new File(dir, "notes").createNewFile();
        assertEquals("notes (2)", DeviceBooksPlugin.freeFile(dir, "notes", null).getName());
    }

    @Test
    public void onlyBookFilesMayBeDeleted() {
        assertTrue(DeviceBooksPlugin.isBookFile(new File("/x/Book.EPUB")));
        assertTrue(DeviceBooksPlugin.isBookFile(new File("/x/book (2).pdf")));
        assertFalse(DeviceBooksPlugin.isBookFile(new File("/x/photo.jpg")));
        assertFalse(DeviceBooksPlugin.isBookFile(new File("/x/epub")));
    }
}
