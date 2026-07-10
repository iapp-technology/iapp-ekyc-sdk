package com.iapp.ekyc.example

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import com.iapp.ekyc.EkycDocumentType
import com.iapp.ekyc.EkycLocale
import com.iapp.ekyc.IappEkycConfig
import com.iapp.ekyc.IappEkycContract
import com.iapp.ekyc.IappEkycRequest
import com.iapp.ekyc.IappEkycResult

/** Kotlin usage: the ActivityResult contract (recommended). */
class MainActivity : ComponentActivity() {
    private val config: IappEkycConfig by lazy {
        IappEkycConfig.Builder("YOUR_API_KEY").locale(EkycLocale.EN).build()
    }

    private lateinit var status: TextView

    private val ekyc = registerForActivityResult(IappEkycContract()) { result ->
        status.text = when (result) {
            is IappEkycResult.DocumentCaptured ->
                "OCR (${result.documentType}):\n${result.rawJson.take(600)}"
            is IappEkycResult.LivenessPassed ->
                // Verify verdictJson + signature on YOUR backend (docs/SECURITY.md).
                "Liveness passed=${result.passed}\nsignature=${result.signature.take(32)}…"
            is IappEkycResult.FaceCaptured ->
                "Selfie captured: ${result.image.size} bytes"
            is IappEkycResult.Failed ->
                "Failed [${result.error.code}]: ${result.error.message}"
            IappEkycResult.Cancelled -> "Cancelled by user"
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }

        fun button(label: String, onClick: () -> Unit) {
            root.addView(Button(this).apply {
                text = label
                setOnClickListener { onClick() }
            })
        }

        button("Capture Thai ID (front)") {
            ekyc.launch(IappEkycRequest.DocumentCapture(config, EkycDocumentType.THAI_ID_FRONT))
        }
        button("Capture passport") {
            ekyc.launch(IappEkycRequest.DocumentCapture(config, EkycDocumentType.PASSPORT))
        }
        button("Face Active Liveness") {
            ekyc.launch(IappEkycRequest.ActiveLiveness(config))
        }
        button("Capture face (no liveness)") {
            ekyc.launch(IappEkycRequest.FaceCapture(config))
        }
        button("Java example →") {
            startActivity(Intent(this, JavaExampleActivity::class.java))
        }

        status = TextView(this).apply { text = "Result appears here" }
        root.addView(status)

        setContentView(ScrollView(this).apply { addView(root) })
    }
}
