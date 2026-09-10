import type { AnalysisResult, UiElement } from './analyzer';

/**
 * Android project generator.
 *
 * Emits a complete, buildable Gradle project — AGP 8.x, Kotlin 2.x, Compose BOM,
 * version catalog, wrapper properties. The intent is that
 * `./gradlew assembleDebug` succeeds on the bridge with no hand-editing.
 */

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GenerateOptions {
  analysis: AnalysisResult;
  minSdk?: number;
  targetSdk?: number;
  /** For the WebView target. */
  webAssetsDir?: string;
  webStartUrl?: string;
  includeInternet?: boolean;
}

const AGP = '8.7.3';
const KOTLIN = '2.1.0';
const COMPOSE_BOM = '2024.12.01';
const GRADLE_WRAPPER = '8.11.1';

const pascal = (s: string) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string) => (c ? c.toUpperCase() : '')).replace(/^(.)/, (c) => c.toUpperCase());

/**
 * Map a desktop widget onto its Compose equivalent, adapted for touch.
 * The adaptation is the point: desktop hit targets are mouse-sized, so every
 * interactive element is widened to the 48dp minimum and stacked vertically for
 * a phone's portrait aspect ratio.
 */
function composeForElement(el: UiElement, index: number): string {
  const label = (el.label ?? el.kind).replace(/"/g, '\\"').slice(0, 60);
  const state = `state${index}`;

  switch (el.kind) {
    case 'button':
      return `        Button(
            onClick = { viewModel.on${pascal((el.action ?? label) || `action${index}`)}() },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)   // touch target minimum
        ) {
            Text("${label}")
        }`;
    case 'text':
      return `        Text(
            text = "${label}",
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.fillMaxWidth()
        )`;
    case 'input':
      return `        OutlinedTextField(
            value = uiState.${state},
            onValueChange = { viewModel.update${pascal(state)}(it) },
            label = { Text("${label}") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )`;
    case 'checkbox':
      return `        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
        ) {
            Checkbox(
                checked = uiState.${state}Checked,
                onCheckedChange = { viewModel.toggle${pascal(state)}(it) }
            )
            Spacer(Modifier.width(8.dp))
            Text("${label}")
        }`;
    case 'select':
      return `        // Desktop combo box -> bottom sheet picker; dropdowns are cramped on phones.
        DropdownField(
            label = "${label}",
            selected = uiState.${state}Selection,
            options = uiState.${state}Options,
            onSelect = { viewModel.select${pascal(state)}(it) }
        )`;
    case 'list':
      return `        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f, fill = false),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            items(uiState.${state}Items) { item ->
                ListItem(
                    headlineContent = { Text(item) },
                    modifier = Modifier.clickable { viewModel.onItemSelected(item) }
                )
            }
        }`;
    case 'table':
      return `        // Desktop data grid -> scrollable card list. Wide tables are unusable
        // on a phone; each row becomes a card with labelled fields.
        LazyColumn(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(uiState.${state}Rows) { row ->
                ElevatedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        row.forEach { (key, value) ->
                            Row(Modifier.fillMaxWidth()) {
                                Text(key, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
                                Text(value, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(2f))
                            }
                        }
                    }
                }
            }
        }`;
    case 'image':
      return `        AsyncImagePlaceholder(
            contentDescription = "${label}",
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
        )`;
    case 'canvas':
      return `        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
        ) {
            // Port the desktop draw calls here; DrawScope units are pixels.
        }`;
    case 'menu':
      return `        // Desktop menu bar -> top app bar overflow, handled in the Scaffold.`;
    default:
      return `        Surface(
            modifier = Modifier.fillMaxWidth(),
            tonalElevation = 1.dp
        ) {
            Text("${label}", Modifier.padding(12.dp))
        }`;
  }
}

function stateFields(elements: UiElement[]): string {
  const fields: string[] = [];
  elements.forEach((el, i) => {
    const state = `state${i}`;
    if (el.kind === 'input') fields.push(`    val ${state}: String = "",`);
    else if (el.kind === 'checkbox') fields.push(`    val ${state}Checked: Boolean = false,`);
    else if (el.kind === 'select') {
      fields.push(`    val ${state}Selection: String = "",`);
      fields.push(`    val ${state}Options: List<String> = emptyList(),`);
    } else if (el.kind === 'list') fields.push(`    val ${state}Items: List<String> = emptyList(),`);
    else if (el.kind === 'table') fields.push(`    val ${state}Rows: List<Map<String, String>> = emptyList(),`);
  });
  return fields.join('\n');
}

function viewModelHandlers(elements: UiElement[]): string {
  const seen = new Set<string>();
  const out: string[] = [];

  elements.forEach((el, i) => {
    const state = `state${i}`;
    if (el.kind === 'button') {
      const name = `on${pascal(el.action ?? el.label ?? `action${i}`)}`;
      if (seen.has(name)) return;
      seen.add(name);
      out.push(`    fun ${name}() {
        viewModelScope.launch {
            // Ported from: ${el.source}${el.action ? ` (${el.action})` : ''}
            _uiState.update { it.copy(status = "${(el.label ?? 'Action').replace(/"/g, '')} invoked") }
        }
    }`);
    } else if (el.kind === 'input') {
      out.push(`    fun update${pascal(state)}(value: String) = _uiState.update { it.copy(${state} = value) }`);
    } else if (el.kind === 'checkbox') {
      out.push(`    fun toggle${pascal(state)}(value: Boolean) = _uiState.update { it.copy(${state}Checked = value) }`);
    } else if (el.kind === 'select') {
      out.push(`    fun select${pascal(state)}(value: String) = _uiState.update { it.copy(${state}Selection = value) }`);
    }
  });

  if (elements.some((el) => el.kind === 'list')) {
    out.push(`    fun onItemSelected(item: String) = _uiState.update { it.copy(status = "Selected: $item") }`);
  }

  return out.join('\n\n');
}

export function generateAndroidProject(opts: GenerateOptions): { files: GeneratedFile[]; notes: string[] } {
  const { analysis } = opts;
  const minSdk = opts.minSdk ?? 24;
  const targetSdk = opts.targetSdk ?? 35;
  const pkg = analysis.packageName;
  const pkgPath = pkg.replace(/\./g, '/');
  const app = pascal(analysis.appName);
  const notes: string[] = [...analysis.notes];
  const isWebView = analysis.target === 'webview-wrapper';

  const files: GeneratedFile[] = [];

  // ── Gradle ────────────────────────────────────────────────────────────────
  files.push({
    path: 'settings.gradle.kts',
    content: `pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\\\.android.*")
                includeGroupByRegex("com\\\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${app}"
include(":app")
`,
  });

  files.push({
    path: 'gradle/libs.versions.toml',
    content: `[versions]
agp = "${AGP}"
kotlin = "${KOTLIN}"
coreKtx = "1.15.0"
lifecycle = "2.8.7"
activityCompose = "1.9.3"
composeBom = "${COMPOSE_BOM}"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
androidx-lifecycle-runtime-ktx = { group = "androidx.lifecycle", name = "lifecycle-runtime-ktx", version.ref = "lifecycle" }
androidx-lifecycle-viewmodel-compose = { group = "androidx.lifecycle", name = "lifecycle-viewmodel-compose", version.ref = "lifecycle" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-ui = { group = "androidx.compose.ui", name = "ui" }
androidx-ui-graphics = { group = "androidx.compose.ui", name = "ui-graphics" }
androidx-ui-tooling = { group = "androidx.compose.ui", name = "ui-tooling" }
androidx-ui-tooling-preview = { group = "androidx.compose.ui", name = "ui-tooling-preview" }
androidx-material3 = { group = "androidx.compose.material3", name = "material3" }
junit = { group = "junit", name = "junit", version = "4.13.2" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
`,
  });

  files.push({
    path: 'build.gradle.kts',
    content: `plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
`,
  });

  files.push({
    path: 'gradle.properties',
    content: `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
org.gradle.parallel=true
org.gradle.caching=true
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
`,
  });

  files.push({
    path: 'gradle/wrapper/gradle-wrapper.properties',
    content: `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-${GRADLE_WRAPPER}-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`,
  });

  files.push({
    path: 'app/build.gradle.kts',
    content: `plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "${pkg}"
    compileSdk = ${targetSdk}

    defaultConfig {
        applicationId = "${pkg}"
        minSdk = ${minSdk}
        targetSdk = ${targetSdk}
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    debugImplementation(libs.androidx.ui.tooling)
    testImplementation(libs.junit)
}
`,
  });

  files.push({
    path: 'app/proguard-rules.pro',
    content: `# Keep the Compose runtime metadata R8 needs.
-keepclassmembers class ** {
    @androidx.compose.runtime.Composable <methods>;
}
-dontwarn kotlinx.**
`,
  });

  // ── Manifest ──────────────────────────────────────────────────────────────
  const needsInternet = opts.includeInternet ?? (isWebView || analysis.dependencies.some((d) => /axios|requests|http|fetch|okhttp/i.test(d)));

  files.push({
    path: 'app/src/main/AndroidManifest.xml',
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
${needsInternet ? '    <uses-permission android:name="android.permission.INTERNET" />\n' : ''}
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/Theme.${app}"
        android:usesCleartextTraffic="false">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|screenLayout|keyboardHidden|uiMode"
            android:windowSoftInputMode="adjustResize"
            android:theme="@style/Theme.${app}">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`,
  });

  // ── Resources ─────────────────────────────────────────────────────────────
  files.push({
    path: 'app/src/main/res/values/strings.xml',
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${analysis.appName}</string>
</resources>
`,
  });

  files.push({
    path: 'app/src/main/res/values/themes.xml',
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.${app}" parent="android:Theme.Material.Light.NoActionBar" />
</resources>
`,
  });

  files.push({
    path: 'app/src/main/res/values-night/themes.xml',
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.${app}" parent="android:Theme.Material.NoActionBar" />
</resources>
`,
  });

  // ── Kotlin sources ────────────────────────────────────────────────────────
  files.push({
    path: `app/src/main/java/${pkgPath}/MainActivity.kt`,
    content: `package ${pkg}

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import ${pkg}.ui.${app}Screen
import ${pkg}.ui.theme.${app}Theme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ${app}Theme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    Scaffold { innerPadding ->
                        ${app}Screen(modifier = Modifier.padding(innerPadding))
                    }
                }
            }
        }
    }
}
`,
  });

  files.push({
    path: `app/src/main/java/${pkgPath}/ui/theme/Theme.kt`,
    content: `package ${pkg}.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val DarkColors = darkColorScheme(
    primary = Color(0xFF10B981),
    secondary = Color(0xFF6366F1),
    background = Color(0xFF09090B),
    surface = Color(0xFF131316)
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF059669),
    secondary = Color(0xFF4F46E5)
)

@Composable
fun ${app}Theme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColors
        else -> LightColors
    }

    MaterialTheme(colorScheme = colorScheme, content = content)
}
`,
  });

  if (isWebView) {
    notes.push('Generated a WebView wrapper. Drop the built web assets into app/src/main/assets/ before building.');
    files.push({
      path: `app/src/main/java/${pkgPath}/ui/${app}Screen.kt`,
      content: `package ${pkg}.ui

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView

/**
 * WebView host for the ported desktop renderer.
 *
 * The original UI is preserved as-is; only navigation, back-button handling and
 * viewport behaviour are adapted for touch.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ${app}Screen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val webView = remember {
        WebView(context).apply {
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                // Let the page's own responsive CSS drive layout instead of
                // desktop-width emulation, which produces a zoomed-out page.
                useWideViewPort = true
                loadWithOverviewMode = true
                cacheMode = WebSettings.LOAD_DEFAULT
                mediaPlaybackRequiresUserGesture = false
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean = false
            }
            loadUrl("${opts.webStartUrl ?? 'file:///android_asset/index.html'}")
        }
    }

    BackHandler(enabled = true) {
        if (webView.canGoBack()) webView.goBack()
    }

    AndroidView(
        factory = { webView },
        modifier = modifier.fillMaxSize()
    )
}
`,
    });
  } else {
    const uiElements = analysis.ui.slice(0, 30);
    const body = uiElements.length
      ? uiElements.map((el, i) => composeForElement(el, i)).join('\n\n')
      : `        Text(
            "No UI was extracted from the source. Replace this with the ported screen.",
            style = MaterialTheme.typography.bodyLarge
        )`;

    files.push({
      path: `app/src/main/java/${pkgPath}/ui/${app}Screen.kt`,
      content: `package ${pkg}.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/**
 * Ported from ${analysis.stack} (${analysis.entryPoints[0] ?? 'unknown entry point'}).
 *
 * Desktop layout adapted for touch: fixed panes become a single scrolling column,
 * every interactive control clears the 48dp touch-target minimum, and the window
 * chrome is replaced by a top app bar.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ${app}Screen(
    modifier: Modifier = Modifier,
    viewModel: ${app}ViewModel = viewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(title = { Text("${analysis.appName}") })
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
${body}

            if (uiState.status.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text(uiState.status, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

@Composable
fun DropdownField(
    label: String,
    selected: String,
    options: List<String>,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var expanded by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }

    Column(modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.labelMedium)
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
        ) {
            Text(selected.ifEmpty { "Select…" })
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option) },
                    onClick = {
                        onSelect(option)
                        expanded = false
                    }
                )
            }
        }
    }
}

@Composable
fun AsyncImagePlaceholder(contentDescription: String, modifier: Modifier = Modifier) {
    Surface(modifier, tonalElevation = 2.dp) {
        Box(contentAlignment = Alignment.Center) {
            Text(contentDescription, style = MaterialTheme.typography.labelSmall)
        }
    }
}
`,
    });

    files.push({
      path: `app/src/main/java/${pkgPath}/ui/${app}ViewModel.kt`,
      content: `package ${pkg}.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ${app}UiState(
${stateFields(uiElements) || '    val placeholder: Boolean = true,'}
    val status: String = "",
    val isLoading: Boolean = false
)

/**
 * State holder for the ported screen.
 *
 * Desktop callbacks ran synchronously on the UI thread. On Android that is an
 * ANR waiting to happen, so every handler is a coroutine on viewModelScope and
 * survives configuration changes.
 */
class ${app}ViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(${app}UiState())
    val uiState: StateFlow<${app}UiState> = _uiState.asStateFlow()

${viewModelHandlers(uiElements) || '    fun noop() = Unit'}
}
`,
    });
  }

  // ── Migration report ──────────────────────────────────────────────────────
  files.push({
    path: 'MIGRATION.md',
    content: `# ${analysis.appName} — desktop → Android migration report

Generated by Chomugiri.

## Source analysis

| | |
|---|---|
| Detected stack | \`${analysis.stack}\` (confidence ${(analysis.confidence * 100).toFixed(0)}%) |
| Android target | \`${analysis.target}\` |
| Package | \`${pkg}\` |
| Entry points | ${analysis.entryPoints.length ? analysis.entryPoints.map((e) => `\`${e}\``).join(', ') : '_none found_'} |
| UI elements mapped | ${analysis.ui.length} |
| Logic modules | ${analysis.logicModules.length} |

## Blockers

${analysis.blockers.length
  ? analysis.blockers
      .map((b) => `### ${b.severity === 'blocker' ? '🔴' : '🟡'} ${b.issue}\n\n${b.remedy}`)
      .join('\n\n')
  : '_None detected._'}

## Business logic to port

${analysis.logicModules.filter((m) => m.kind === 'business-logic').length
  ? analysis.logicModules
      .filter((m) => m.kind === 'business-logic')
      .map((m) => `- \`${m.file}\` — ${m.symbols.slice(0, 8).join(', ')}${m.symbols.length > 8 ? ` (+${m.symbols.length - 8} more)` : ''}`)
      .join('\n')
  : '_No clearly separable business logic found — the UI and logic are likely interleaved and need manual extraction._'}

## Dependencies found in the source

${analysis.dependencies.length ? analysis.dependencies.map((d) => `- \`${d}\``).join('\n') : '_none_'}

These are **not** auto-mapped to Android equivalents; each needs a deliberate decision.

## Build

\`\`\`bash
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease        # requires a signing config
\`\`\`

## Notes

${notes.length ? notes.map((n) => `- ${n}`).join('\n') : '_none_'}
`,
  });

  files.push({
    path: '.gitignore',
    content: `*.iml
.gradle/
local.properties
.idea/
.DS_Store
build/
captures/
.externalNativeBuild/
.cxx/
`,
  });

  return { files, notes };
}

/** The exact command sequence the bridge runs to produce an APK. */
export function buildCommands(opts: { release?: boolean; projectDir?: string } = {}): string[] {
  const dir = opts.projectDir ?? '.';
  const task = opts.release ? 'assembleRelease' : 'assembleDebug';
  return [
    `cd ${dir} && chmod +x ./gradlew 2>/dev/null || true`,
    `cd ${dir} && ./gradlew --version || gradle wrapper --gradle-version ${GRADLE_WRAPPER}`,
    `cd ${dir} && ./gradlew ${task} --stacktrace --no-daemon`,
  ];
}

/**
 * Preflight the toolchain before a build.
 * A missing JDK surfaces here as one clear line rather than 300 lines of Gradle
 * stack trace forty seconds into a compile.
 */
export function toolchainPreflight(toolchains: { java: string | null; androidSdk: string | null; gradle: string | null }): {
  ready: boolean;
  problems: Array<{ issue: string; fix: string }>;
} {
  const problems: Array<{ issue: string; fix: string }> = [];

  if (!toolchains.java) {
    problems.push({
      issue: 'No JDK on the bridge host.',
      fix: 'Install JDK 17: `sudo apt install openjdk-17-jdk` (Linux) or `brew install openjdk@17` (macOS). AGP 8.x requires 17+.',
    });
  } else {
    const version = /(?:version\s+")?(\d+)(?:\.(\d+))?/.exec(toolchains.java);
    const major = version ? Number(version[1] === '1' ? version[2] : version[1]) : 0;
    if (major && major < 17) {
      problems.push({
        issue: `JDK ${major} is installed; AGP ${AGP} requires 17 or newer.`,
        fix: 'Install JDK 17 and point JAVA_HOME at it.',
      });
    }
  }

  if (!toolchains.androidSdk) {
    problems.push({
      issue: 'ANDROID_HOME / ANDROID_SDK_ROOT is not set.',
      fix: 'Install the command-line tools, then: `sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"` and export ANDROID_HOME.',
    });
  }

  return { ready: problems.length === 0, problems };
}
