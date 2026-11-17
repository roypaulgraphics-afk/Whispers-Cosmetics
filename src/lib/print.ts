interface ReceiptPrinterPlugin {
  print: () => Promise<unknown>;
}

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  Plugins?: { ReceiptPrinter?: ReceiptPrinterPlugin };
}

/**
 * Uses the Android print service inside the wrapped APK, where window.print()
 * is a no-op, and falls back to the browser dialog everywhere else.
 */
export function printReceipt(): void {
  const bridge = (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
  const printer = bridge?.Plugins?.ReceiptPrinter;
  if (bridge?.isNativePlatform?.() && printer) {
    void printer.print().catch(() => window.print());
    return;
  }
  window.print();
}
