package com.whispers.cosmetics;

import android.content.Context;
import android.print.PrintManager;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReceiptPrinter")
public class ReceiptPrinterPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            WebView webView = getBridge().getWebView();
            PrintManager printManager =
                (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
            String jobName = getContext().getString(R.string.app_name) + " receipt";
            printManager.print(jobName, webView.createPrintDocumentAdapter(jobName), null);
            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
        });
    }
}
