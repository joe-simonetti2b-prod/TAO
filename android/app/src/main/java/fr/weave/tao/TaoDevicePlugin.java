package fr.weave.tao;

// TAO – module natif : volume figé, sortie audio, kiosque, écran allumé.
// © 2026 Joseph-Marie Simonetti – Weave. Tous droits réservés.

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;

import android.Manifest;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioTimestamp;
import android.media.AudioTrack;
import android.media.MediaRecorder;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "TaoDevice", permissions = {
    @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
})
public class TaoDevicePlugin extends Plugin {

    static volatile boolean volumeLocked = false;
    static volatile int lockedIndex = -1;

    private AudioManager am;
    private BroadcastReceiver volumeReceiver;
    private AudioDeviceCallback deviceCallback;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public void load() {
        am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            deviceCallback = new AudioDeviceCallback() {
                @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) { notifyRoute(); }
                @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) { notifyRoute(); }
            };
            am.registerAudioDeviceCallback(deviceCallback, main);
        }
    }

    private JSObject status() {
        boolean wired = false, bluetooth = false, usb = false;
        String btName = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int t = d.getType();
                if (t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_WIRED_HEADSET) wired = true;
                if (t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                    bluetooth = true;
                    if (btName == null && d.getProductName() != null) btName = d.getProductName().toString();
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && (t == AudioDeviceInfo.TYPE_BLE_HEADSET || t == AudioDeviceInfo.TYPE_BLE_SPEAKER)) bluetooth = true;
                if (t == AudioDeviceInfo.TYPE_USB_HEADSET || t == AudioDeviceInfo.TYPE_USB_DEVICE) usb = true;
            }
        } else {
            //noinspection deprecation
            wired = am.isWiredHeadsetOn();
            //noinspection deprecation
            bluetooth = am.isBluetoothA2dpOn();
        }
        String route = bluetooth ? "bluetooth" : usb ? "usb" : wired ? "casque filaire" : "haut-parleur";
        JSObject o = new JSObject();
        o.put("wired", wired && !usb);
        o.put("bluetooth", bluetooth);
        o.put("usb", usb);
        o.put("route", route);
        o.put("btName", btName);
        o.put("volumeIndex", am.getStreamVolume(AudioManager.STREAM_MUSIC));
        o.put("volumeMax", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        o.put("locked", volumeLocked);
        o.put("deviceOwner", isDeviceOwner());
        o.put("kiosk", kioskActive());
        o.put("lockedIndex", lockedIndex);
        return o;
    }

    private void notifyRoute() {
        try { notifyListeners("routeChange", status()); } catch (Exception ignored) {}
    }

    private int applyVolume(int index) {
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int idx = Math.max(0, Math.min(max, index));
        try { am.setStreamVolume(AudioManager.STREAM_MUSIC, idx, 0); } catch (Exception ignored) {}
        return am.getStreamVolume(AudioManager.STREAM_MUSIC);
    }

    @PluginMethod
    public void getStatus(PluginCall call) { call.resolve(status()); }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Integer index = call.getInt("index");
        if (index == null) { call.reject("index manquant"); return; }
        JSObject o = new JSObject();
        o.put("index", applyVolume(index));
        call.resolve(o);
    }

    @PluginMethod
    public void lockVolume(PluginCall call) {
        Integer index = call.getInt("index");
        if (index == null) { call.reject("index manquant"); return; }
        lockedIndex = index;
        volumeLocked = true;
        int actual = applyVolume(index);
        if (volumeReceiver == null) {
            volumeReceiver = new BroadcastReceiver() {
                @Override public void onReceive(Context c, Intent i) {
                    if (!volumeLocked) return;
                    if (am.getStreamVolume(AudioManager.STREAM_MUSIC) != lockedIndex) {
                        main.post(() -> applyVolume(lockedIndex));
                    }
                }
            };
            IntentFilter f = new IntentFilter("android.media.VOLUME_CHANGED_ACTION");
            if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(volumeReceiver, f, Context.RECEIVER_NOT_EXPORTED);
            else getContext().registerReceiver(volumeReceiver, f);
        }
        JSObject o = new JSObject();
        o.put("index", actual);
        o.put("requested", index);
        o.put("max", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        o.put("capped", actual != index);
        call.resolve(o);
    }

    @PluginMethod
    public void unlockVolume(PluginCall call) {
        volumeLocked = false;
        if (volumeReceiver != null) {
            try { getContext().unregisterReceiver(volumeReceiver); } catch (Exception ignored) {}
            volumeReceiver = null;
        }
        call.resolve();
    }

    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        Activity a = getActivity();
        if (a != null) a.runOnUiThread(() -> {
            if (on) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }

    // ---------- Kiosque ----------
    static volatile boolean kioskWanted = false;

    private DevicePolicyManager dpm() { return (DevicePolicyManager) getContext().getSystemService(Context.DEVICE_POLICY_SERVICE); }
    private ComponentName admin() { return new ComponentName(getContext(), TaoAdminReceiver.class); }
    private ComponentName home() { return new ComponentName(getContext(), getContext().getPackageName() + ".KioskHome"); }

    private boolean isDeviceOwner() {
        try { return dpm().isDeviceOwnerApp(getContext().getPackageName()); } catch (Exception e) { return false; }
    }

    private boolean kioskActive() {
        try {
            ActivityManager am2 = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) return am2.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
        } catch (Exception ignored) {}
        return false;
    }

    private void setHomeEnabled(boolean on) {
        try {
            getContext().getPackageManager().setComponentEnabledSetting(home(),
                on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP);
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void startKiosk(PluginCall call) {
        Activity a = getActivity();
        kioskWanted = true;
        boolean owner = isDeviceOwner();
        if (owner) {
            try {
                DevicePolicyManager d = dpm();
                d.setLockTaskPackages(admin(), new String[]{ getContext().getPackageName() });
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) d.setLockTaskFeatures(admin(), DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) { d.setStatusBarDisabled(admin(), true); d.setKeyguardDisabled(admin(), true); }
                // TAO devient l'écran d'accueil de la tablette (redémarre directement dans l'appli)
                setHomeEnabled(true);
                IntentFilter f = new IntentFilter(Intent.ACTION_MAIN);
                f.addCategory(Intent.CATEGORY_HOME); f.addCategory(Intent.CATEGORY_DEFAULT);
                d.addPersistentPreferredActivity(admin(), f, home());
            } catch (Exception ignored) {}
        }
        if (a != null) a.runOnUiThread(() -> { try { a.startLockTask(); } catch (Exception ignored) {} });
        JSObject o = new JSObject();
        o.put("deviceOwner", owner);
        o.put("mode", owner ? "proprietaire" : "epinglage");
        call.resolve(o);
    }

    @PluginMethod
    public void stopKiosk(PluginCall call) {
        Activity a = getActivity();
        kioskWanted = false;
        if (isDeviceOwner()) {
            try {
                DevicePolicyManager d = dpm();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) { d.setStatusBarDisabled(admin(), false); d.setKeyguardDisabled(admin(), false); }
                d.clearPackagePersistentPreferredActivities(admin(), getContext().getPackageName());
                setHomeEnabled(false);
            } catch (Exception ignored) {}
        }
        if (a != null) a.runOnUiThread(() -> { try { a.stopLockTask(); } catch (Exception ignored) {} });
        call.resolve();
    }

    // Contrôle d'authenticité : la version doit être signée avec le certificat officiel TAO
    @PluginMethod
    public void getIntegrity(PluginCall call) {
        JSObject o = new JSObject();
        String expected = BuildConfig.TAO_CERT_SHA256;
        String actual = "";
        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            android.content.pm.Signature[] sigs;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                android.content.pm.PackageInfo pi = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
                sigs = pi.signingInfo.getApkContentsSigners();
            } else {
                //noinspection deprecation
                sigs = pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES).signatures;
            }
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] h = md.digest(sigs[0].toByteArray());
            StringBuilder sb = new StringBuilder();
            for (byte b : h) sb.append(String.format("%02X", b));
            actual = sb.toString();
        } catch (Exception e) { o.put("error", String.valueOf(e)); }
        boolean debuggable = (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        o.put("expected", expected);
        o.put("actual", actual);
        o.put("debuggable", debuggable);
        o.put("ok", expected == null || expected.isEmpty() || expected.equalsIgnoreCase(actual));
        call.resolve(o);
    }

    // Réglages audio d'accessibilité (lecture seule) : audio mono et balance gauche/droite
    @PluginMethod
    public void getAudioSettings(PluginCall call) {
        JSObject o = new JSObject();
        try { o.put("mono", android.provider.Settings.System.getInt(getContext().getContentResolver(), "master_mono", 0) == 1); }
        catch (Exception e) { o.put("mono", JSObject.NULL); }
        try { o.put("balance", android.provider.Settings.System.getFloat(getContext().getContentResolver(), "master_balance", 0f)); }
        catch (Exception e) { o.put("balance", JSObject.NULL); }
        call.resolve(o);
    }

    // Ouvre une page des réglages Android (assistant d'installation)
    @PluginMethod
    public void openSettings(PluginCall call) {
        String page = call.getString("page", "settings");
        String action;
        switch (page) {
            case "bluetooth": action = android.provider.Settings.ACTION_BLUETOOTH_SETTINGS; break;
            case "accessibility": action = android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS; break;
            case "sound": action = android.provider.Settings.ACTION_SOUND_SETTINGS; break;
            case "display": action = android.provider.Settings.ACTION_DISPLAY_SETTINGS; break;
            default: action = android.provider.Settings.ACTION_SETTINGS;
        }
        try {
            Intent i = new Intent(action);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) { call.reject(String.valueOf(e)); }
    }

    // Quitter l'application (réservé à l'administrateur, après code)
    @PluginMethod
    public void exitApp(PluginCall call) {
        Activity a = getActivity();
        kioskWanted = false;
        call.resolve();
        if (a != null) a.runOnUiThread(() -> {
            try { a.stopLockTask(); } catch (Exception ignored) {}
            a.finishAndRemoveTask();
        });
    }

    // Retire le statut « propriétaire de l'appareil » (permet de désinstaller TAO normalement)
    @PluginMethod
    public void releaseDeviceOwner(PluginCall call) {
        try {
            if (isDeviceOwner()) {
                DevicePolicyManager d = dpm();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) d.setStatusBarDisabled(admin(), false);
                d.clearPackagePersistentPreferredActivities(admin(), getContext().getPackageName());
                setHomeEnabled(false);
                Activity a = getActivity();
                if (a != null) a.runOnUiThread(() -> { try { a.stopLockTask(); } catch (Exception ignored) {} });
                d.clearDeviceOwnerApp(getContext().getPackageName());
            }
            JSObject o = new JSObject(); o.put("deviceOwner", isDeviceOwner()); call.resolve(o);
        } catch (Exception e) { call.reject(String.valueOf(e)); }
    }

    // =====================================================================
    // Sortie son native (v0.9.1)
    // Les sons de test sont joués par Android lui-même, en stéréo, une oreille
    // à zéro absolu. Le moteur audio de la page web n'est plus utilisé pour le
    // test : sur certains appareils (Bluetooth, mode « appel »), il pouvait
    // perdre le canal droit.
    // =====================================================================

    static final double MAX_DBFS = -1.0;
    private final Object audioLock = new Object();
    private AudioTrack stimTrack = null;
    private int stimId = 0;
    private final java.util.LinkedHashMap<String, float[]> synthCache = new java.util.LinkedHashMap<String, float[]>(16, 0.75f, true) {
        @Override protected boolean removeEldestEntry(java.util.Map.Entry<String, float[]> e) { return size() > 24; }
    };

    private int outRate() {
        int r = 0;
        try { r = AudioTrack.getNativeOutputSampleRate(AudioManager.STREAM_MUSIC); } catch (Exception ignored) {}
        return r > 0 ? r : 48000;
    }

    private static AudioAttributes mediaAttrs() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build();
    }

    private static AudioFormat stereoFloat(int sr) {
        return new AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
            .setSampleRate(sr)
            .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
            .build();
    }

    // Garde-fou : jamais de son de test en mode « appel » (sortie Bluetooth mono)
    @SuppressWarnings("deprecation")
    private String ensureNormalMode() {
        try {
            if (Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice();
            if (am.isBluetoothScoOn()) { am.stopBluetoothSco(); am.setBluetoothScoOn(false); }
            if (am.getMode() != AudioManager.MODE_NORMAL) am.setMode(AudioManager.MODE_NORMAL);
        } catch (Exception ignored) {}
        int m = am.getMode();
        return m == AudioManager.MODE_NORMAL ? null : "le téléphone est en mode appel";
    }

    private static String typeName(int t) {
        switch (t) {
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: return "casque filaire";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET: return "casque filaire (micro)";
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP: return "bluetooth";
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO: return "bluetooth (mode appel)";
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: return "haut-parleur";
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE: return "écouteur interne";
            case AudioDeviceInfo.TYPE_USB_HEADSET: case AudioDeviceInfo.TYPE_USB_DEVICE: return "usb";
            default: return "type " + t;
        }
    }

    // Renvoie un motif si la sortie réellement utilisée ne sépare pas droite et gauche
    private static String monoReason(AudioDeviceInfo d) {
        if (d == null) return null;
        int t = d.getType();
        if (t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return "Bluetooth en mode appel (mono)";
        if (t == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) return "écouteur interne (mono)";
        int[] cc = d.getChannelCounts();
        if (cc != null && cc.length > 0) {
            int max = 0; for (int c : cc) max = Math.max(max, c);
            if (max < 2) return typeName(t) + " (mono)";
        }
        return null;
    }

    private void releaseTrack(AudioTrack t) {
        if (t == null) return;
        try { t.setVolume(0f); } catch (Exception ignored) {}
        // courte attente : Android applique la baisse de volume en rampe (pas de clic)
        main.postDelayed(() -> {
            try { t.pause(); t.flush(); } catch (Exception ignored) {}
            try { t.release(); } catch (Exception ignored) {}
        }, 30);
    }

    private void stopStim(int id) {
        AudioTrack t = null;
        synchronized (audioLock) {
            if (stimTrack != null && (id < 0 || id == stimId)) { t = stimTrack; stimTrack = null; }
        }
        releaseTrack(t);
    }

    private float[] monoStimulus(double freq, String type, double dur, int sr) {
        String key = freq + "|" + type + "|" + dur + "|" + sr;
        synchronized (synthCache) {
            float[] m = synthCache.get(key);
            if (m == null) { m = TaoSynth.synth(freq, type, dur, sr); synthCache.put(key, m); }
            return m;
        }
    }

    @PluginMethod
    public void playStimulus(PluginCall call) {
        final Double freq = call.getDouble("freq");
        final Double dbfs = call.getDouble("dbfs");
        final String ear = call.getString("ear", "L");
        final double dur = call.getDouble("duration", 2.0);
        final String type = call.getString("type", "theme");
        final boolean allowMono = Boolean.TRUE.equals(call.getBoolean("allowMono", false));
        if (freq == null || dbfs == null) { call.reject("paramètres manquants"); return; }
        if (dbfs > MAX_DBFS + 1e-9) { call.reject("Niveau trop élevé"); return; }

        String modeErr = ensureNormalMode();
        if (modeErr != null && !allowMono) {
            JSObject o = new JSObject(); o.put("ok", false); o.put("error", "Sortie audio mono : " + modeErr); call.resolve(o); return;
        }
        final int sr = outRate();
        final float[] st = TaoSynth.stereo(monoStimulus(freq, type, dur, sr), "R".equals(ear), Math.pow(10, dbfs / 20));
        final AudioTrack tr;
        try {
            tr = new AudioTrack.Builder()
                .setAudioAttributes(mediaAttrs())
                .setAudioFormat(stereoFloat(sr))
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(st.length * 4)
                .build();
            int w = tr.write(st, 0, st.length, AudioTrack.WRITE_BLOCKING);
            if (w != st.length) { try { tr.release(); } catch (Exception ignored) {} call.reject("écriture audio incomplète (" + w + ")"); return; }
        } catch (Exception e) { call.reject("AudioTrack : " + e); return; }

        final int id;
        AudioTrack old;
        synchronized (audioLock) { old = stimTrack; stimTrack = tr; id = ++stimId; }
        releaseTrack(old);
        final long t0 = System.nanoTime();
        try { tr.play(); } catch (Exception e) { stopStim(id); call.reject("lecture : " + e); return; }

        new Thread(() -> {
            // Instant réel où le premier échantillon sort du casque (horodatage Android)
            long frame0 = -1;
            AudioTimestamp ts = new AudioTimestamp();
            long deadline = System.nanoTime() + 400_000_000L;
            while (System.nanoTime() < deadline) {
                try {
                    if (tr.getPlayState() != AudioTrack.PLAYSTATE_PLAYING) break;
                    if (tr.getTimestamp(ts) && ts.framePosition > 0) {
                        frame0 = ts.nanoTime - Math.round(ts.framePosition * 1e9 / sr);
                        break;
                    }
                } catch (Exception ignored) { break; }
                try { Thread.sleep(5); } catch (InterruptedException ignored) {}
            }
            AudioDeviceInfo rd = null;
            try { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) rd = tr.getRoutedDevice(); } catch (Exception ignored) {}
            String mono = modeErr != null ? modeErr : monoReason(rd);
            long now = System.nanoTime();
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("sampleRate", sr);
            o.put("timestamp", frame0 > 0);
            o.put("startsInMs", frame0 > 0 ? (frame0 - now) / 1e6 : (t0 - now) / 1e6 + 40);
            o.put("route", rd != null ? typeName(rd.getType()) : JSObject.NULL);
            if (mono != null) {
                o.put("mono", mono);
                if (!allowMono) { stopStim(id); o.put("ok", false); o.put("error", "Sortie audio mono : " + mono); call.resolve(o); return; }
            }
            o.put("ok", true);
            call.resolve(o);
        }, "tao-stim").start();

        // Libération automatique en fin de son
        main.postDelayed(() -> {
            boolean mine;
            synchronized (audioLock) { mine = stimTrack == tr; if (mine) stimTrack = null; }
            if (mine) { try { tr.stop(); } catch (Exception ignored) {} try { tr.release(); } catch (Exception ignored) {} }
        }, Math.round(dur * 1000) + 1500);
    }

    @PluginMethod
    public void stopStimulus(PluginCall call) {
        stopStim(call.getInt("id", -1));
        call.resolve();
    }

    // ---------- Son pur continu (étalonnage au sonomètre / coupleur) ----------
    private volatile boolean toneRun = false;
    private volatile double toneTarget = 0;
    private Thread toneThread = null;

    @PluginMethod
    public void toneStart(PluginCall call) {
        final Double freq = call.getDouble("freq");
        final Double dbfs = call.getDouble("dbfs");
        final String ear = call.getString("ear", "L");
        final boolean allowMono = Boolean.TRUE.equals(call.getBoolean("allowMono", false));
        if (freq == null || dbfs == null) { call.reject("paramètres manquants"); return; }
        if (dbfs > MAX_DBFS + 1e-9) { call.reject("Niveau trop élevé"); return; }
        stopToneNow();
        String modeErr = ensureNormalMode();
        if (modeErr != null && !allowMono) { JSObject o = new JSObject(); o.put("ok", false); o.put("error", "Sortie audio mono : " + modeErr); call.resolve(o); return; }
        final int sr = outRate();
        final int frames = 480;
        final AudioTrack tr;
        try {
            int min = AudioTrack.getMinBufferSize(sr, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_FLOAT);
            tr = new AudioTrack.Builder()
                .setAudioAttributes(mediaAttrs())
                .setAudioFormat(stereoFloat(sr))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(Math.max(min, frames * 2 * 4 * 4))
                .build();
        } catch (Exception e) { call.reject("AudioTrack : " + e); return; }
        toneTarget = Math.pow(10, dbfs / 20);
        toneRun = true;
        final int ch = "R".equals(ear) ? 1 : 0;
        final double f = freq;
        toneThread = new Thread(() -> {
            double ph = 0, g = 0;
            double k = 1 - Math.exp(-1.0 / (0.02 * sr)); // lissage du gain, constante 20 ms
            float[] buf = new float[frames * 2];
            try { tr.play(); } catch (Exception e) { toneRun = false; }
            while (toneRun) {
                java.util.Arrays.fill(buf, 0f);
                double tgt = toneTarget;
                for (int i = 0; i < frames; i++) {
                    g += (tgt - g) * k;
                    ph += 2 * Math.PI * f / sr;
                    if (ph > 2 * Math.PI) ph -= 2 * Math.PI;
                    buf[2 * i + ch] = (float) (Math.sin(ph) * g);
                }
                tr.write(buf, 0, buf.length, AudioTrack.WRITE_BLOCKING);
            }
            // fondu de sortie (~80 ms) puis arrêt
            for (int r = 0; r < 8; r++) {
                java.util.Arrays.fill(buf, 0f);
                for (int i = 0; i < frames; i++) { g += (0 - g) * k * 2; ph += 2 * Math.PI * f / sr; buf[2 * i + ch] = (float) (Math.sin(ph) * g); }
                tr.write(buf, 0, buf.length, AudioTrack.WRITE_BLOCKING);
            }
            try { tr.stop(); } catch (Exception ignored) {}
            try { tr.release(); } catch (Exception ignored) {}
        }, "tao-tone");
        toneThread.start();
        JSObject o = new JSObject(); o.put("ok", true); if (modeErr != null) o.put("mono", modeErr); call.resolve(o);
    }

    @PluginMethod
    public void toneSet(PluginCall call) {
        Double dbfs = call.getDouble("dbfs");
        if (dbfs != null && dbfs <= MAX_DBFS + 1e-9) toneTarget = Math.pow(10, dbfs / 20);
        call.resolve();
    }

    private void stopToneNow() {
        toneRun = false;
        Thread t = toneThread; toneThread = null;
        if (t != null) { try { t.join(400); } catch (InterruptedException ignored) {} }
    }

    @PluginMethod
    public void toneStop(PluginCall call) { stopToneNow(); call.resolve(); }

    // =====================================================================
    // Micro natif : toujours le micro de la tablette, sans traitement, et
    // sans faire basculer un casque Bluetooth en mode « appel ».
    // =====================================================================

    private AudioRecord rec = null;
    private volatile boolean recRun = false;
    private TaoSpectrum spec = null;
    private String micSource = null;

    @PluginMethod
    public void micStart(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermCallback");
            return;
        }
        startMic(call);
    }

    @PermissionCallback
    private void micPermCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) startMic(call);
        else { JSObject o = new JSObject(); o.put("ok", false); o.put("error", "autorisation micro refusée"); call.resolve(o); }
    }

    private void startMic(PluginCall call) {
        if (recRun && rec != null) { JSObject o = new JSObject(); o.put("ok", true); o.put("source", micSource); call.resolve(o); return; }
        final int sr = 48000, n = 8192;
        int[] sources;
        boolean unproc = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try { unproc = "true".equals(am.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED)); } catch (Exception ignored) {}
        }
        sources = unproc
            ? new int[]{ MediaRecorder.AudioSource.UNPROCESSED, MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC }
            : new int[]{ MediaRecorder.AudioSource.VOICE_RECOGNITION, MediaRecorder.AudioSource.MIC };
        AudioRecord r = null; String name = null;
        int min = AudioRecord.getMinBufferSize(sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT);
        for (int s : sources) {
            try {
                AudioRecord c = new AudioRecord.Builder()
                    .setAudioSource(s)
                    .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                        .setSampleRate(sr).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
                    .setBufferSizeInBytes(Math.max(min * 2, n * 4))
                    .build();
                if (c.getState() == AudioRecord.STATE_INITIALIZED) {
                    r = c;
                    name = s == MediaRecorder.AudioSource.UNPROCESSED ? "brut" : s == MediaRecorder.AudioSource.VOICE_RECOGNITION ? "reconnaissance" : "standard";
                    break;
                }
                c.release();
            } catch (Exception ignored) {}
        }
        if (r == null) { JSObject o = new JSObject(); o.put("ok", false); o.put("error", "micro indisponible"); call.resolve(o); return; }
        // Micro intégré de la tablette, même si un casque avec micro est branché
        for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
            if (d.getType() == AudioDeviceInfo.TYPE_BUILTIN_MIC) { try { r.setPreferredDevice(d); } catch (Exception ignored) {} break; }
        }
        rec = r; micSource = name; spec = new TaoSpectrum(n, sr, 0.6);
        recRun = true;
        try { r.startRecording(); } catch (Exception e) {
            recRun = false; try { r.release(); } catch (Exception ignored) {} rec = null;
            JSObject o = new JSObject(); o.put("ok", false); o.put("error", "micro : " + e); call.resolve(o); return;
        }
        final AudioRecord fr = r; final TaoSpectrum fs = spec;
        new Thread(() -> {
            float[] ring = new float[n], frame = new float[n], chunk = new float[1024];
            int pos = 0, filled = 0, sinceLast = 0;
            final int hop = sr / 10; // une analyse toutes les 100 ms
            while (recRun) {
                int got;
                try { got = fr.read(chunk, 0, chunk.length, AudioRecord.READ_BLOCKING); } catch (Exception e) { break; }
                if (got <= 0) { try { Thread.sleep(10); } catch (InterruptedException ignored) {} continue; }
                for (int i = 0; i < got; i++) { ring[pos] = chunk[i]; pos = (pos + 1) % n; }
                filled = Math.min(n, filled + got); sinceLast += got;
                if (filled == n && sinceLast >= hop) {
                    sinceLast = 0;
                    for (int i = 0; i < n; i++) frame[i] = ring[(pos + i) % n];
                    fs.push(frame);
                }
            }
            try { fr.stop(); } catch (Exception ignored) {}
            try { fr.release(); } catch (Exception ignored) {}
        }, "tao-mic").start();
        JSObject o = new JSObject(); o.put("ok", true); o.put("source", name); o.put("sampleRate", sr); call.resolve(o);
    }

    @PluginMethod
    public void micLevels(PluginCall call) {
        JSObject o = new JSObject();
        TaoSpectrum s = spec;
        if (!recRun || s == null) { o.put("ok", false); call.resolve(o); return; }
        o.put("ok", true);
        o.put("ready", s.ready());
        if (s.ready()) {
            JSObject b = new JSObject();
            for (int f : new int[]{ 500, 1000, 2000, 3000, 4000 }) b.put(String.valueOf(f), s.band(f));
            o.put("bands", b);
            o.put("a", s.levelA());
        }
        o.put("source", micSource);
        call.resolve(o);
    }

    @PluginMethod
    public void micStop(PluginCall call) {
        recRun = false; rec = null; spec = null;
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        volumeLocked = false;
        recRun = false; toneRun = false; stopStim(-1);
        if (volumeReceiver != null) { try { getContext().unregisterReceiver(volumeReceiver); } catch (Exception ignored) {} }
        if (deviceCallback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) am.unregisterAudioDeviceCallback(deviceCallback);
        super.handleOnDestroy();
    }
}
