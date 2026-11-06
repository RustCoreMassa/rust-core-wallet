package com.rustcoremassa.wallet;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;

/**
 * Unlocking with the fingerprint / face instead of typing the PIN — the counterpart of
 * ios/App/App/BiometricUnlockPlugin.swift, used by src/native/native-biometric-unlock.ts.
 *
 * <p>The PIN is encrypted with the public half of an RSA key pair kept in the Android Keystore;
 * the private half decrypts it only after a strong biometric check (BiometricPrompt with a
 * CryptoObject — every use), and is destroyed for good when a fingerprint or face is added
 * (setInvalidatedByBiometricEnrollment). Saving needs no check; reading always does — as on iOS.
 */
@CapacitorPlugin(name = "BiometricUnlock")
public class BiometricUnlockPlugin extends Plugin {

    private static final String KEY_ALIAS = "rustcore_biometric_key";
    private static final String PREFS = "rustcore_biometric";
    private static final String ITEM = "unlock-secret";
    private static final String TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding";
    /** The Keystore takes SHA-1 for MGF1 on every Android version. */
    private static final OAEPParameterSpec OAEP = new OAEPParameterSpec(
        "SHA-256",
        "MGF1",
        MGF1ParameterSpec.SHA1,
        PSource.PSpecified.DEFAULT
    );
    private static final int STRONG = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    /** "fingerprint", "biometric" (face, iris or several) or "none". */
    @PluginMethod
    public void availability(PluginCall call) {
        JSObject result = new JSObject();
        if (BiometricManager.from(getContext()).canAuthenticate(STRONG) != BiometricManager.BIOMETRIC_SUCCESS) {
            result.put("kind", "none");
        } else {
            PackageManager pm = getContext().getPackageManager();
            boolean other =
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
                (pm.hasSystemFeature(PackageManager.FEATURE_FACE) || pm.hasSystemFeature(PackageManager.FEATURE_IRIS));
            boolean fingerprint = pm.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT);
            result.put("kind", fingerprint && !other ? "fingerprint" : "biometric");
        }
        call.resolve(result);
    }

    @PluginMethod
    public void save(PluginCall call) {
        String secret = call.getString("secret");
        if (secret == null || secret.isEmpty()) {
            call.reject("secret is required", "failed");
            return;
        }
        try {
            deleteKeyAndItem();
            KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setKeySize(2048)
                .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
            }
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore");
            generator.initialize(spec.build());
            PublicKey keystorePublic = generator.generateKeyPair().getPublic();
            // Encrypting needs no biometric check: the public key, outside the Keystore.
            PublicKey publicKey = KeyFactory.getInstance(keystorePublic.getAlgorithm()).generatePublic(
                new X509EncodedKeySpec(keystorePublic.getEncoded())
            );
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, publicKey, OAEP);
            String sealed = Base64.encodeToString(cipher.doFinal(secret.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (prefs().edit().putString(ITEM, sealed).commit()) {
                call.resolve();
            } else {
                call.reject("Saving failed", "failed");
            }
        } catch (Exception e) {
            call.reject("Biometric protection isn't available", "failed", e);
        }
    }

    /**
     * Shows the system's biometric prompt and returns the secret. Rejects with code "canceled",
     * "unavailable" (gone: biometrics changed, never saved) or "failed".
     */
    @PluginMethod
    public void read(PluginCall call) {
        String sealed = prefs().getString(ITEM, null);
        Cipher cipher;
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            PrivateKey privateKey = (PrivateKey) keyStore.getKey(KEY_ALIAS, null);
            if (sealed == null || privateKey == null) {
                call.reject("Not available any more", "unavailable");
                return;
            }
            cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, privateKey, OAEP);
        } catch (KeyPermanentlyInvalidatedException e) {
            // A fingerprint or face was added: the key is gone for good.
            deleteKeyAndItem();
            call.reject("Not available any more", "unavailable");
            return;
        } catch (Exception e) {
            call.reject("Biometric check failed", "failed", e);
            return;
        }

        String reason = call.getString("reason", "Unlock your wallet");
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle("RustCore Wallet")
            .setSubtitle(reason)
            .setNegativeButtonText("Use PIN")
            .setAllowedAuthenticators(STRONG)
            .setConfirmationRequired(false)
            .build();
        AtomicBoolean done = new AtomicBoolean(false);
        BiometricPrompt.AuthenticationCallback callback = new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                if (done.getAndSet(true)) return;
                try {
                    BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                    byte[] plain = crypto.getCipher().doFinal(Base64.decode(sealed, Base64.NO_WRAP));
                    JSObject out = new JSObject();
                    out.put("secret", new String(plain, StandardCharsets.UTF_8));
                    call.resolve(out);
                } catch (Exception e) {
                    call.reject("Biometric check failed", "failed", e);
                }
            }

            @Override
            public void onAuthenticationError(int code, @NonNull CharSequence message) {
                if (done.getAndSet(true)) return;
                boolean cancelled =
                    code == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                    code == BiometricPrompt.ERROR_USER_CANCELED ||
                    code == BiometricPrompt.ERROR_CANCELED;
                call.reject(message.toString(), cancelled ? "canceled" : "failed");
            }
            // onAuthenticationFailed: one attempt not recognised — the prompt stays and lets the
            // user try again.
        };
        getActivity()
            .runOnUiThread(() -> {
                FragmentActivity activity = (FragmentActivity) getActivity();
                new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback).authenticate(
                    info,
                    new BiometricPrompt.CryptoObject(cipher)
                );
            });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        deleteKeyAndItem();
        call.resolve();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void deleteKeyAndItem() {
        prefs().edit().remove(ITEM).commit();
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            keyStore.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
            // Nothing to delete.
        }
    }
}
