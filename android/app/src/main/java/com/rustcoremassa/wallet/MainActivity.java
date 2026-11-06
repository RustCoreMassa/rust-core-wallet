package com.rustcoremassa.wallet;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

/**
 * Capacitor's activity, plus the plugins that live in this app (not in npm packages) — see
 * ios/App/App/MainViewController.swift for the iOS side.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeStorePlugin.class);
        registerPlugin(SecretClipboardPlugin.class);
        registerPlugin(BiometricUnlockPlugin.class);
        registerPlugin(QrScannerPlugin.class);
        registerPlugin(ShareSheetPlugin.class);
        super.onCreate(savedInstanceState);
        // The recent-apps screen shows no balances or addresses (as iOS's app switcher cover).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) setRecentsScreenshotEnabled(false);
    }

    // Before Android 13 there's no such switch: the window is marked secure while the app is in
    // the background, which keeps it out of the recent-apps thumbnail (best effort).
    @Override
    public void onPause() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }
}
