package fr.weave.tao;

// © 2026 Joseph-Marie Simonetti – Weave. Tous droits réservés.

import android.os.Bundle;
import android.view.KeyEvent;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TaoDevicePlugin.class);
        super.onCreate(savedInstanceState);
        // Interdit captures et enregistrements d'écran (protection de l'interface)
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
    }

    // Touches de volume neutralisées pendant le test et l'étalonnage
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int k = event.getKeyCode();
        if (TaoDevicePlugin.volumeLocked &&
            (k == KeyEvent.KEYCODE_VOLUME_UP || k == KeyEvent.KEYCODE_VOLUME_DOWN || k == KeyEvent.KEYCODE_VOLUME_MUTE)) {
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
