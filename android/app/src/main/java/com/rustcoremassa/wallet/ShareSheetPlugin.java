package com.rustcoremassa.wallet;

import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Android's share menu for a piece of text (Receive → Share) — see ios/App/App/ShareSheetPlugin.swift. */
@CapacitorPlugin(name = "ShareSheet")
public class ShareSheetPlugin extends Plugin {

    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("text is required");
            return;
        }
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
        getActivity()
            .runOnUiThread(() -> {
                getActivity().startActivity(Intent.createChooser(send, null));
                call.resolve();
            });
    }
}
