package com.rustcoremassa.wallet;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.Key;
import java.security.KeyStore;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The app's lasting key–value store (LOCAL_STORE: the encrypted vault, device preferences) on
 * Android — the counterpart of ios/App/App/NativeStorePlugin.swift, used by
 * src/native/native-storage-area.ts.
 *
 * <p>Each value is encrypted (AES-GCM, bound to its key name) with a key that lives in the Android
 * Keystore and never leaves it — usable only while the phone is unlocked (Android 9+) — and kept in
 * the app's private SharedPreferences. Uninstalling deletes both. Backups and device-to-device
 * transfers leave them out (res/xml/data_extraction_rules.xml); a copy restored elsewhere couldn't
 * be read anyway, the key never leaves this phone.
 */
@CapacitorPlugin(name = "NativeStore")
public class NativeStorePlugin extends Plugin {

    private static final String PREFS = "rustcore_store";
    private static final String KEY_ALIAS = "rustcore_store_key";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    @PluginMethod
    public void getAll(PluginCall call) {
        try {
            SecretKey key = key();
            JSObject items = new JSObject();
            for (Map.Entry<String, ?> entry : prefs().getAll().entrySet()) {
                if (!(entry.getValue() instanceof String)) continue;
                try {
                    items.put(entry.getKey(), decrypt(key, entry.getKey(), (String) entry.getValue()));
                } catch (Exception e) {
                    // Never deleted here: a later write of the same key replaces it.
                    Logger.warn("NativeStore", "Skipping an item that can't be read: " + entry.getKey());
                }
            }
            JSObject result = new JSObject();
            result.put("items", items);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Reading secure storage failed", e);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String name = call.getString("key");
        String value = call.getString("value");
        if (name == null || value == null) {
            call.reject("key and value are required");
            return;
        }
        try {
            // commit(), not apply(): resolved only once it is on disk.
            if (prefs().edit().putString(name, encrypt(key(), name, value)).commit()) {
                call.resolve();
            } else {
                call.reject("Saving to secure storage failed");
            }
        } catch (Exception e) {
            call.reject("Saving to secure storage failed", e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String name = call.getString("key");
        if (name == null) {
            call.reject("key is required");
            return;
        }
        if (prefs().edit().remove(name).commit()) {
            call.resolve();
        } else {
            call.reject("Removing from secure storage failed");
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey key() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        Key existing = keyStore.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;

        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) spec.setUnlockedDeviceRequired(true);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(spec.build());
        return generator.generateKey();
    }

    /** Base64 of IV ‖ ciphertext; the item's name is authenticated with it (no swapping values). */
    private static String encrypt(SecretKey key, String name, String value) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key);
        cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        byte[] sealed = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        return Base64.encodeToString(ByteBuffer.allocate(iv.length + sealed.length).put(iv).put(sealed).array(), Base64.NO_WRAP);
    }

    private static String decrypt(SecretKey key, String name, String stored) throws Exception {
        byte[] bytes = Base64.decode(stored, Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES));
        cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(bytes, IV_BYTES, bytes.length - IV_BYTES), StandardCharsets.UTF_8);
    }
}
