package com.yanivm.reader;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Reads aloud with the phone's own text-to-speech engine, since Android's WebView has no speechSynthesis.
 *
 * Needs registerPlugin(NativeTtsPlugin.class) in MainActivity, ReadAloudService (foregroundServiceType
 * mediaPlayback) in AndroidManifest.xml, and a <queries> entry for android.intent.action.TTS_SERVICE so the engine
 * is visible from Android 11 (android.yml adds them).
 *
 * The web app still drives the reading sentence by sentence (it marks each sentence and turns the pages); this
 * plugin only speaks. While reading, ReadAloudService holds the process and the CPU so the WebView keeps feeding
 * sentences with the screen off, and the app holds the audio focus: another app taking it (a call, music) or the
 * notification's stop button ends the reading.
 *
 * JS:
 *   voices() -> {voices: [{id, lang, network}]}: the installed voices (lang as a BCP 47 tag)
 *   speak({text, rate, lang?, voice?}) -> resolves once spoken; rejects with code NO_VOICE (nothing installed for
 *     the language), INTERRUPTED (stopped from outside since begin) or UNAVAILABLE (no working engine)
 *   begin({title, text, stop}) -> the reading starts: notification (stop = its button's label), audio focus
 *   stop() -> silences, resolves what was waiting, ends the notification and gives back the audio focus
 */
@CapacitorPlugin(name = "NativeTts")
public class NativeTtsPlugin extends Plugin {
    private static NativeTtsPlugin instance;

    private TextToSpeech tts;
    /** null while the engine starts, then whether it can be used */
    private Boolean ready;
    private final List<Runnable> waiting = new ArrayList<>();
    /** speak calls by the id of their (last) utterance */
    private final Map<String, PluginCall> pending = new ConcurrentHashMap<>();
    private volatile boolean interrupted;
    /** "lang|voice" last set on the engine, so it isn't switched again for every sentence */
    private String applied;
    private AudioFocusRequest focusRequest;
    private final AudioManager.OnAudioFocusChangeListener onFocus = change -> {
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) interrupt();
    };

    @Override
    public void load() {
        instance = this;
        tts = new TextToSpeech(getContext(), status -> {
            List<Runnable> run;
            synchronized (waiting) {
                ready = status == TextToSpeech.SUCCESS;
                run = new ArrayList<>(waiting);
                waiting.clear();
            }
            for (Runnable r : run) r.run();
        });
        tts.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build());
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String id) {}

            @Override
            public void onDone(String id) {
                finish(id);
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onError(String id) {
                finish(id);
            }

            @Override
            public void onError(String id, int code) {
                finish(id);
            }

            @Override
            public void onStop(String id, boolean wasSpeaking) {
                finish(id);
            }
        });
    }

    /** the notification's stop button */
    static void stopFromNotification() {
        if (instance != null) instance.interrupt();
    }

    @PluginMethod
    public void voices(PluginCall call) {
        whenReady(call, () -> {
            JSArray list = new JSArray();
            Set<Voice> all = tts.getVoices();
            if (all != null) {
                for (Voice v : all) {
                    if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                    JSObject o = new JSObject();
                    o.put("id", v.getName());
                    o.put("lang", v.getLocale().toLanguageTag());
                    o.put("network", v.isNetworkConnectionRequired());
                    list.put(o);
                }
            }
            JSObject ret = new JSObject();
            ret.put("voices", list);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        whenReady(call, () -> {
            if (interrupted) {
                call.reject("stopped", "INTERRUPTED");
                return;
            }
            String text = call.getString("text", "");
            if (!apply(call.getString("lang", ""), call.getString("voice", ""))) {
                call.reject("no voice for the language", "NO_VOICE");
                return;
            }
            tts.setSpeechRate(call.getFloat("rate", 1f));
            // a "sentence" longer than the engine takes is spoken in pieces; the call ends with the last one
            int max = Math.max(100, TextToSpeech.getMaxSpeechInputLength() - 1);
            String id = null;
            for (int i = 0; i < text.length() || id == null; i += max) {
                id = UUID.randomUUID().toString();
                boolean last = i + max >= text.length();
                if (last) pending.put(id, call);
                if (tts.speak(text.substring(Math.min(i, text.length()), Math.min(i + max, text.length())), TextToSpeech.QUEUE_ADD, null, id) != TextToSpeech.SUCCESS && last) finish(id);
            }
        });
    }

    @PluginMethod
    public void begin(PluginCall call) {
        interrupted = false;
        requestFocus();
        ReadAloudService.start(getContext(), call.getString("title", ""), call.getString("text", ""), call.getString("stop", ""));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        for (String id : new ArrayList<>(pending.keySet())) finish(id);
        interrupted = false;
        end();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        for (String id : new ArrayList<>(pending.keySet())) finish(id);
        end();
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    /** stopped from outside the web app: what is waiting and what comes next is refused until stop() */
    private void interrupt() {
        interrupted = true;
        if (tts != null) tts.stop();
        for (String id : new ArrayList<>(pending.keySet())) {
            PluginCall c = pending.remove(id);
            if (c != null) c.reject("stopped", "INTERRUPTED");
        }
        end();
    }

    private void finish(String id) {
        PluginCall c = pending.remove(id);
        if (c != null) c.resolve();
    }

    private void whenReady(PluginCall call, Runnable r) {
        synchronized (waiting) {
            if (ready == null) {
                waiting.add(() -> whenReady(call, r));
                return;
            }
        }
        if (ready) r.run();
        else call.reject("no text-to-speech engine", "UNAVAILABLE");
    }

    /** sets the chosen voice, or else the language's default voice; false when the language has no voice */
    private boolean apply(String lang, String voice) {
        String key = lang + "|" + voice;
        if (key.equals(applied)) return true;
        boolean set = false;
        if (!voice.isEmpty()) {
            Set<Voice> all = tts.getVoices();
            if (all != null) {
                for (Voice v : all) {
                    if (v.getName().equals(voice)) {
                        set = tts.setVoice(v) == TextToSpeech.SUCCESS;
                        break;
                    }
                }
            }
        }
        if (!set && !lang.isEmpty()) {
            int r = tts.setLanguage(Locale.forLanguageTag(lang));
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) return false;
        }
        applied = key;
        return true;
    }

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @SuppressWarnings("deprecation")
    private void requestFocus() {
        AudioManager am = audio();
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest == null) {
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build())
                    .setOnAudioFocusChangeListener(onFocus)
                    .build();
            }
            am.requestAudioFocus(focusRequest);
        } else {
            am.requestAudioFocus(onFocus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
    }

    @SuppressWarnings("deprecation")
    private void end() {
        AudioManager am = audio();
        if (am != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focusRequest != null) am.abandonAudioFocusRequest(focusRequest);
            } else {
                am.abandonAudioFocus(onFocus);
            }
        }
        ReadAloudService.stop(getContext());
    }
}
