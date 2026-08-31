package com.iapp.ekyc.example;

import android.graphics.Color;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.ComponentActivity;
import androidx.annotation.Nullable;

import com.iapp.ekyc.EkycDocumentType;
import com.iapp.ekyc.EkycLocale;
import com.iapp.ekyc.IappEkyc;
import com.iapp.ekyc.IappEkycCallback;
import com.iapp.ekyc.IappEkycConfig;
import com.iapp.ekyc.IappEkycError;
import com.iapp.ekyc.IappEkycRequest;
import com.iapp.ekyc.IappEkycResult;

/** Java usage: the simple callback entry point. */
public class JavaExampleActivity extends ComponentActivity {
    private TextView status;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final boolean hasApiKey = ApiKeyGuide.isConfigured(BuildConfig.IAPP_API_KEY);
        // Builder.build() refuses the placeholder, so only build with a real key.
        final IappEkycConfig config = hasApiKey
                ? new IappEkycConfig.Builder(BuildConfig.IAPP_API_KEY).locale(EkycLocale.TH).build()
                : null;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 48, 48, 48);

        if (!hasApiKey) {
            TextView guide = new TextView(this);
            guide.setText(ApiKeyGuide.TEXT);
            guide.setTextColor(Color.parseColor("#B91C1C"));
            guide.setTextSize(14f);
            guide.setPadding(0, 0, 0, 40);
            root.addView(guide);
        }

        Button capture = new Button(this);
        capture.setText("Capture Thai ID (front) — Java");
        capture.setOnClickListener(v -> {
            if (config == null) {
                status.setText(ApiKeyGuide.TEXT);
                return;
            }
            IappEkyc.start(
                this,
                new IappEkycRequest.DocumentCapture(config, EkycDocumentType.THAI_ID_FRONT),
                new IappEkycCallback() {
                    @Override
                    public void onResult(IappEkycResult result) {
                        if (result instanceof IappEkycResult.DocumentCaptured) {
                            String raw = ((IappEkycResult.DocumentCaptured) result).getRawJson();
                            status.setText("OCR: " + raw);
                        }
                    }

                    @Override
                    public void onError(IappEkycError error) {
                        status.setText("Failed [" + error.getCode() + "]: " + error.getMessage());
                    }

                    @Override
                    public void onCancelled() {
                        status.setText("Cancelled by user");
                    }
                });
        });
        root.addView(capture);

        status = new TextView(this);
        status.setText("Result appears here");
        root.addView(status);

        setContentView(root);
    }
}
