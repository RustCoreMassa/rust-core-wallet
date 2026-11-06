package com.rustcoremassa.wallet;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Copies a private key as a secret — the counterpart of ios/App/App/SecretClipboardPlugin.swift.
 * Marked sensitive (Android 13+ hides it from the clipboard preview, keyboards stop suggesting it),
 * and emptied after `seconds` by the app — as long as Android keeps the app's process; Android
 * 13+ also clears the clipboard by itself after a while.
 */
@CapacitorPlugin(name = "SecretClipboard")
public class SecretClipboardPlugin extends Plugin {

    /** The key the system reads; ClipDescription.EXTRA_IS_SENSITIVE from Android 13 on. */
    private static final String IS_SENSITIVE = "android.content.extra.IS_SENSITIVE";

    private final Handler main = new Handler(Looper.getMainLooper());
    private Runnable pendingClear;

    @PluginMethod
    public void copy(PluginCall call) {
        String text = call.getString("text");
        Double seconds = call.getDouble("seconds");
        if (text == null || seconds == null || seconds <= 0) {
            call.reject("text and a positive seconds are required");
            return;
        }
        main.post(() -> {
            ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            ClipData clip = ClipData.newPlainText("Private key", text);
            PersistableBundle extras = new PersistableBundle();
            extras.putBoolean(Build.VERSION.SDK_INT >= 33 ? ClipDescription.EXTRA_IS_SENSITIVE : IS_SENSITIVE, true);
            clip.getDescription().setExtras(extras);
            clipboard.setPrimaryClip(clip);

            if (pendingClear != null) main.removeCallbacks(pendingClear);
            pendingClear = () -> {
                pendingClear = null;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    clipboard.clearPrimaryClip();
                } else {
                    clipboard.setPrimaryClip(ClipData.newPlainText("", ""));
                }
            };
            main.postDelayed(pendingClear, Math.round(seconds * 1000));
            call.resolve();
        });
    }
}
