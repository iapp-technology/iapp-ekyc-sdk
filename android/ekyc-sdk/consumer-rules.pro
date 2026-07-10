# The JS bridge is invoked reflectively by the WebView.
-keepclassmembers class com.iapp.ekyc.internal.EkycBridge {
    @android.webkit.JavascriptInterface <methods>;
}
