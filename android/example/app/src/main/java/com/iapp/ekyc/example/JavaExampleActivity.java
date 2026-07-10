package com.iapp.ekyc.example;

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

        IappEkycConfig config = new IappEkycConfig.Builder("YOUR_API_KEY")
                .locale(EkycLocale.TH)
                .build();

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 48, 48, 48);

        Button capture = new Button(this);
        capture.setText("Capture Thai ID (front) — Java");
        capture.setOnClickListener(v -> IappEkyc.start(
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
                }));
        root.addView(capture);

        status = new TextView(this);
        status.setText("Result appears here");
        root.addView(status);

        setContentView(root);
    }
}
