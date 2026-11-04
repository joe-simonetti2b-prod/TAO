package fr.weave.tao;

// TAO – module natif : volume figé, sortie audio, kiosque, écran allumé.
// © 2026 Joseph-Marie Simonetti – Weave. Tous droits réservés.

import android.app.Activity;
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            for (AudioDeviceInfo d : am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int t = d.getType();
                if (t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_WIRED_HEADSET) wired = true;
                if (t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) bluetooth = true;
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
        o.put("volumeIndex", am.getStreamVolume(AudioManager.STREAM_MUSIC));
        o.put("volumeMax", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        o.put("locked", volumeLocked);
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

    @PluginMethod
    public void startKiosk(PluginCall call) {
        Activity a = getActivity();
        if (a != null) a.runOnUiThread(() -> { try { a.startLockTask(); } catch (Exception ignored) {} });
        call.resolve();
    }

    @PluginMethod
    public void stopKiosk(PluginCall call) {
        Activity a = getActivity();
        if (a != null) a.runOnUiThread(() -> { try { a.stopLockTask(); } catch (Exception ignored) {} });
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        volumeLocked = false;
        if (volumeReceiver != null) { try { getContext().unregisterReceiver(volumeReceiver); } catch (Exception ignored) {} }
        if (deviceCallback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) am.unregisterAudioDeviceCallback(deviceCallback);
        super.handleOnDestroy();
    }
}
