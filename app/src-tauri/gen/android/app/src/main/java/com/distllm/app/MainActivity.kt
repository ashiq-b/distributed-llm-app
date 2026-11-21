package com.distllm.app

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  /** The latest insets in CSS pixels, as `top,right,bottom,left,keyboard`. */
  @Volatile private var insets = "0,0,0,0,0"

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /**
   * The app draws edge to edge, but Android's WebView before Chromium 136 doesn't give the
   * page `env(safe-area-inset-*)`, and the keyboard covers the page rather than resizing
   * it. So hand it the status bar, gesture bar, cutout and keyboard sizes as CSS variables
   * (`--inset-top` and so on, `--inset-keyboard`; theme.css): pushed on
   * every change, and readable at startup through `window.DistllmInsets.get()`.
   */
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(object {
      @JavascriptInterface fun get(): String = insets

      /** Status and gesture bar icons light on the dark theme, dark on the light one. */
      @JavascriptInterface fun setDark(dark: Boolean) = runOnUiThread {
        WindowInsetsControllerCompat(window, window.decorView).apply {
          isAppearanceLightStatusBars = !dark
          isAppearanceLightNavigationBars = !dark
        }
      }
    }, "DistllmInsets")
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, all ->
      val bars = all.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = all.getInsets(WindowInsetsCompat.Type.ime())
      val d = resources.displayMetrics.density
      fun css(px: Int) = (px / d).toInt()
      insets = "${css(bars.top)},${css(bars.right)},${css(bars.bottom)},${css(bars.left)},${css(ime.bottom)}"
      view.post { (view as WebView).evaluateJavascript("window.__distllmInsets&&window.__distllmInsets('$insets')", null) }
      all
    }
  }
}
