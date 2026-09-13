package com.chomugiri.workspace

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Menu
import android.view.MenuItem
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import com.chomugiri.workspace.server.AndroidAssetSource
import com.chomugiri.workspace.server.ApiRouter
import com.chomugiri.workspace.server.HttpServer
import com.chomugiri.workspace.server.PrefsSecretStore

/**
 * Chomugiri workspace shell.
 *
 * The web UI runs unmodified inside a WebView pointed at a loopback HTTP server
 * that this process owns. That server answers the same `/api` routes routes the
 * Next.js build provides, implemented natively — which is what makes the app
 * standalone: no deployment, no CORS, and the NVIDIA key never leaves the device.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var server: HttpServer
    private lateinit var router: ApiRouter
    private var filePicker: ValueCallback<Array<Uri>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = filePicker ?: return@registerForActivityResult
        filePicker = null
        callback.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        router = ApiRouter(PrefsSecretStore(this))
        server = HttpServer(
            AndroidAssetSource(assets),
            router,
            log = { message, error -> android.util.Log.i("ChomugiriHttp", message, error) },
        )
        val port = server.start()

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(0xFF09090B.toInt())

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                // IndexedDB backs every suite's history; without a writable path
                // the workspace silently loses all persistence.
                allowFileAccess = false
                allowContentAccess = false
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_DEFAULT
                // The UI is already responsive; desktop-width emulation would
                // render it zoomed out.
                useWideViewPort = true
                loadWithOverviewMode = true
                setSupportZoom(false)
                textZoom = 100
                // A WebView drops window.open silently unless multiple windows
                // are supported, so any link the app opens would simply never
                // appear; onCreateWindow below routes it out to the system
                // browser instead of opening a second WebView.
                setSupportMultipleWindows(true)
                javaScriptCanOpenWindowsAutomatically = true
            }

            CookieManager.getInstance().setAcceptCookie(true)
            // Puter's SDK and its sign-in window are a different origin from the
            // loopback page that hosts them; without this their session cookie
            // is dropped and the user is signed out on every call.
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

            webChromeClient = object : WebChromeClient() {
                /**
                 * window.open lands here, and the target URL is not passed in —
                 * the documented route is a second WebView that reports the URL
                 * it was asked to load.
                 *
                 * Where it goes depends on what it is. An ordinary link belongs
                 * in the system browser. A sign-in window does not: Puter's
                 * keyless provider signs the user in through a popup that talks
                 * back to its opener with postMessage, and a popup handed to
                 * Chrome has no opener to talk to — so sign-in could never
                 * finish inside the app. Those stay in-process, in a dialog.
                 */
                override fun onCreateWindow(
                    view: WebView?,
                    isDialog: Boolean,
                    isUserGesture: Boolean,
                    resultMsg: android.os.Message?,
                ): Boolean {
                    val host = view ?: return false
                    val msg = resultMsg ?: return false

                    @SuppressLint("SetJavaScriptEnabled")
                    val popup = WebView(host.context).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.databaseEnabled = true
                        settings.setSupportMultipleWindows(true)
                        settings.javaScriptCanOpenWindowsAutomatically = true
                    }
                    CookieManager.getInstance().setAcceptThirdPartyCookies(popup, true)

                    var routed = false
                    popup.webViewClient = object : WebViewClient() {
                        override fun onPageStarted(v: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                            if (routed) return
                            routed = true
                            val uri = runCatching { Uri.parse(url) }.getOrNull()
                            if (isSignInHost(uri?.host)) showPopupWindow(popup)
                            else {
                                uri?.let { startActivity(Intent(Intent.ACTION_VIEW, it)) }
                                closePopupWindow()
                            }
                        }
                    }
                    popup.webChromeClient = object : WebChromeClient() {
                        // The sign-in page closes itself when it is done.
                        override fun onCloseWindow(window: WebView?) = closePopupWindow()
                    }

                    (msg.obj as? WebView.WebViewTransport)?.webView = popup
                    msg.sendToTarget()
                    return true
                }

                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    android.util.Log.d("ChomugiriWeb", "${message.messageLevel()} ${message.message()} @${message.lineNumber()}")
                    return true
                }

                override fun onShowFileChooser(
                    view: WebView?,
                    callback: ValueCallback<Array<Uri>>?,
                    params: FileChooserParams?,
                ): Boolean {
                    filePicker?.onReceiveValue(null)
                    filePicker = callback
                    val intent = params?.createIntent()
                    if (intent == null) {
                        filePicker = null
                        return false
                    }
                    return runCatching {
                        pickFiles.launch(intent)
                        true
                    }.getOrElse {
                        filePicker = null
                        false
                    }
                }
            }
        }

        setContentView(webView)

        // The session token gates /api endpoints so other apps sharing loopback
        // cannot drive the user's keys. Re-injected on every navigation, because
        // an evaluateJavascript call does not survive one — and attached before
        // the first load so the very first document is covered too.
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                view?.evaluateJavascript(bootstrapScript(), null)
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                if (url.host == "127.0.0.1") return false
                startActivity(Intent(Intent.ACTION_VIEW, url))
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // A sign-in window is the thing on screen; back closes that first.
                if (popupWindow != null) closePopupWindow()
                else if (webView.canGoBack()) webView.goBack()
                else finish()
            }
        })

        webView.loadUrl("http://127.0.0.1:$port/")

        if (router.nimKey.isEmpty()) {
            webView.postDelayed({ promptForKey(firstRun = true) }, 1200)
        }
    }

    // ── In-app sign-in window ───────────────────────────────────────────────

    private var popupWindow: AlertDialog? = null
    private var popupView: WebView? = null

    /**
     * Hosts whose popup has to stay inside the app.
     *
     * A sign-in popup reports its result to the window that opened it. Handing
     * it to the system browser breaks that link, and the sign-in can never
     * complete — which is the difference between Puter working in the APK and
     * not working at all.
     */
    private fun isSignInHost(host: String?): Boolean {
        val h = host?.lowercase() ?: return false
        return h == "puter.com" || h.endsWith(".puter.com")
    }

    private fun showPopupWindow(popup: WebView) {
        closePopupWindow()
        popupView = popup
        popupWindow = AlertDialog.Builder(this)
            .setView(popup)
            .setOnDismissListener { destroyPopupView() }
            .create()
            .also { it.show() }
    }

    private fun closePopupWindow() {
        val dialog = popupWindow
        popupWindow = null
        if (dialog != null) dialog.dismiss() else destroyPopupView()
    }

    private fun destroyPopupView() {
        val popup = popupView ?: return
        popupView = null
        (popup.parent as? ViewGroup)?.removeView(popup)
        popup.destroy()
    }

    /**
     * Patches `fetch` so every same-origin `/api` call carries the session token.
     * Done here rather than in the web client so the browser build stays free of
     * Android-specific branches.
     */
    private fun bootstrapScript(): String = """
        (function () {
          if (window.__chomugiriShell) return;
          window.__chomugiriShell = { platform: 'android', token: '${server.sessionToken}' };

          var original = window.fetch;
          window.fetch = function (input, init) {
            try {
              var url = typeof input === 'string' ? input : (input && input.url) || '';
              if (url.indexOf('/api/') === 0 || url.indexOf('http://127.0.0.1') === 0) {
                init = init || {};
                var headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined));
                headers.set('X-Chomugiri-Session', window.__chomugiriShell.token);
                init = Object.assign({}, init, { headers: headers });
                if (typeof input !== 'string') input = input.url;
              }
            } catch (e) { /* fall through to the untouched request */ }
            return original.call(this, input, init);
          };
        })();
    """.trimIndent()

    // ── Options menu ────────────────────────────────────────────────────────

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, MENU_KEYS, 0, "API keys").setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER)
        menu.add(0, MENU_RELOAD, 1, "Reload workspace").setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER)
        menu.add(0, MENU_ABOUT, 2, "About").setShowAsAction(MenuItem.SHOW_AS_ACTION_NEVER)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean = when (item.itemId) {
        MENU_KEYS -> { promptForKey(firstRun = false); true }
        MENU_RELOAD -> { webView.reload(); true }
        MENU_ABOUT -> { showAbout(); true }
        else -> super.onOptionsItemSelected(item)
    }

    private fun promptForKey(firstRun: Boolean) {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            setText(router.nimKey)
            hint = "nvapi-..."
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(56, 24, 56, 0)
            addView(input)
        }

        AlertDialog.Builder(this)
            .setTitle("NVIDIA NIM API key")
            .setMessage(
                if (firstRun)
                    "Chomugiri runs entirely on this device. Paste a free key from build.nvidia.com to unlock the NIM catalogue — Kimi K3, DeepSeek V4, Nemotron.\n\nYou can skip this: Pollinations models need no key at all."
                else
                    "Stored on this device only. Get a free key at build.nvidia.com."
            )
            .setView(container)
            .setPositiveButton("Save") { _, _ ->
                router.nimKey = input.text.toString()
                Toast.makeText(this, if (router.nimKey.isEmpty()) "Key cleared" else "Key saved — reloading", Toast.LENGTH_SHORT).show()
                webView.reload()
            }
            .setNeutralButton("Get a key") { _, _ ->
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://build.nvidia.com")))
            }
            .setNegativeButton(if (firstRun) "Skip" else "Cancel", null)
            .show()
    }

    private fun showAbout() {
        AlertDialog.Builder(this)
            .setTitle("Chomugiri")
            .setMessage(
                "Autonomous developer workspace.\n\n" +
                    "The UI runs against a loopback HTTP server inside this app, which implements the same /api routes the web build serves. " +
                    "Nothing is proxied through a third party — model calls go straight from your device to NVIDIA NIM, Pollinations, or your own endpoint.\n\n" +
                    "Terminal builds still need the bridge daemon on your machine: run `npm run agent`, expose it with ngrok or cloudflared, then paste the URL and token into Settings → Terminal Bridge."
            )
            .setPositiveButton("OK", null)
            .show()
    }

    override fun onDestroy() {
        server.stop()
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val MENU_KEYS = 1
        private const val MENU_RELOAD = 2
        private const val MENU_ABOUT = 3
    }
}
