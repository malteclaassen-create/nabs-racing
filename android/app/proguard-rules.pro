# The widget page calls back into the app through WidgetRenderer.Bridge; the
# default rules keep @JavascriptInterface methods, this keeps the class name tidy
# in crash reports too.
-keep class com.nabsracing.app.WidgetRenderer$Bridge { *; }
