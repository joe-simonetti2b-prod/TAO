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

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "TaoDevice")
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

    @Override
    protected void handleOnDestroy() {
        volumeLocked = false;
        if (volumeReceiver != null) { try { getContext().unregisterReceiver(volumeReceiver); } catch (Exception ignored) {} }
        if (deviceCallback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) am.unregisterAudioDeviceCallback(deviceCallback);
        super.handleOnDestroy();
    }
}
