package com.rustcoremassa.wallet;

import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.zxing.client.android.Intents;
import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanIntentResult;
import com.journeyapps.barcodescanner.ScanOptions;

/**
 * Reads a QR code with the camera (Send → Scan) — the counterpart of
 * ios/App/App/QrScannerPlugin.swift. The scanner is ZXing (zxing-android-embedded, Apache 2.0,
 * open source; no Google Play services): it asks for the camera permission itself. Resolves
 * `{ text }` (absent when the user went back); rejects with code "denied" without camera access.
 */
@CapacitorPlugin(name = "QrScanner")
public class QrScannerPlugin extends Plugin {

    @PluginMethod
    public void scan(PluginCall call) {
        ScanOptions options = new ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("Point the camera at a Massa address QR code")
            .setBeepEnabled(false)
            .setOrientationLocked(true);
        Intent intent = new ScanContract().createIntent(getContext(), options);
        startActivityForResult(call, intent, "scanned");
    }

    @ActivityCallback
    private void scanned(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ScanIntentResult scan = ScanIntentResult.parseActivityResult(result.getResultCode(), result.getData());
        if (scan.getContents() != null) {
            JSObject out = new JSObject();
            out.put("text", scan.getContents());
            call.resolve(out);
            return;
        }
        Intent original = scan.getOriginalIntent();
        if (original != null && original.hasExtra(Intents.Scan.MISSING_CAMERA_PERMISSION)) {
            call.reject("Camera access is off", "denied");
            return;
        }
        call.resolve(new JSObject());
    }
}
