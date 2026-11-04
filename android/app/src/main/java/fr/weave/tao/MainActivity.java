package fr.weave.tao;

// © 2026 Joseph-Marie Simonetti – Weave. Tous droits réservés.

import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TaoDevicePlugin.class);
        super.onCreate(savedInstanceState);
        // Interdit captures et enregistrements d'écran (protection de l'interface)
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        hideSystemBars();
    }

    // Plein écran immersif (barres système masquées)
    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
        // Si le kiosque est actif et que l'appli revient au premier plan, on reverrouille
        if (TaoDevicePlugin.kioskWanted) { try { startLockTask(); } catch (Exception ignored) {} }
    }

    // Touches de volume neutralisées pendant le test et l'étalonnage
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int k = event.getKeyCode();
        // Bouton retour neutralisé : seul l'administrateur peut quitter l'appli
        if (k == KeyEvent.KEYCODE_BACK) return true;
        if (TaoDevicePlugin.volumeLocked &&
            (k == KeyEvent.KEYCODE_VOLUME_UP || k == KeyEvent.KEYCODE_VOLUME_DOWN || k == KeyEvent.KEYCODE_VOLUME_MUTE)) {
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
