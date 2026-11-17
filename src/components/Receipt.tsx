import React from 'react';
import { Printer } from 'lucide-react';
import type { CreditRecord, RefundRecord, SaleTransaction, StoreSettings } from '../types';
import { moneyExact, dateTime } from '../lib/format';
import { printReceipt } from '../lib/print';
import { Button, Modal } from './ui';

const ReceiptPaper: React.FC<{
  sale: SaleTransaction;
  settings: StoreSettings;
  credit?: CreditRecord;
  refund?: RefundRecord;
}> = ({ sale, settings, credit, refund }) => {
  const currency = settings.currency;
  return (
    <div className="receipt-print mx-auto bg-white text-stone-900 border border-stone-200 rounded-lg p-5 w-full max-w-[80mm] text-[11px] leading-relaxed">
      <div className="text-center">
        {settings.logoUrl && (
          <img src={settings.logoUrl} alt="" className="w-10 h-10 mx-auto mb-2 object-contain" />
        )}
        <h3 className="font-display text-lg font-semibold tracking-wide">{settings.storeName}</h3>
        <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">
          {refund ? 'Refund Receipt' : 'Sales Receipt'}
        </p>
        {settings.mpesaTillNumber && (
          <p className="text-[10px] text-stone-500">M-Pesa Till {settings.mpesaTillNumber}</p>
        )}
      </div>

      <div className="border-t border-dashed border-stone-300 my-3" />

      <div className="flex justify-between gap-2">
        <span>Receipt</span>
        <span className="font-mono font-semibold">
          {refund ? refund.refundNo : sale.receiptNo}
        </span>
      </div>
      <div className="flex justify-between gap-2">
        <span>Date</span>
        <span className="font-mono">{dateTime(sale.createdAt)}</span>
      </div>
      <div className="flex justify-between gap-2">
        <span>Served by</span>
        <span>{sale.cashier}</span>
      </div>
      {credit && (
        <>
          <div className="flex justify-between gap-2">
            <span>Customer</span>
            <span>{credit.creditorName}</span>
          </div>
          {credit.creditorPhone && (
            <div className="flex justify-between gap-2">
              <span>Phone</span>
              <span className="font-mono">{credit.creditorPhone}</span>
            </div>
          )}
        </>
      )}

      <div className="border-t border-dashed border-stone-300 my-3" />

      {refund ? (
        <div className="space-y-1.5">
          {refund.items.map((item) => (
            <div key={item.id ?? item.saleItemId}>
              <div className="flex justify-between gap-2">
                <span className="flex-1">{item.productName}</span>
                <span className="font-mono">{item.quantity} × {moneyExact(item.unitPrice, currency)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          {sale.items.map((item) => (
            <div key={item.id ?? item.productId}>
              <div className="flex justify-between gap-2">
                <span className="flex-1">{item.productName}</span>
                <span className="font-mono">{moneyExact(item.unitPrice * item.quantity, currency)}</span>
              </div>
              <div className="text-[10px] text-stone-500">
                {item.quantity} × {moneyExact(item.unitPrice, currency)}
                {(item.refundedQuantity ?? 0) > 0 && ` · ${item.refundedQuantity} refunded`}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-dashed border-stone-300 my-3" />

      {refund ? (
        <>
          <div className="flex justify-between text-sm font-semibold">
            <span>Refund total</span>
            <span className="font-mono">{moneyExact(refund.totalAmount, currency)}</span>
          </div>
          <div className="flex justify-between gap-2 mt-1">
            <span>Method</span>
            <span>{refund.method === 'Mpesa' ? 'M-Pesa (manual payout)' : 'Cash'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Original sale</span>
            <span className="font-mono">{refund.saleReceiptNo}</span>
          </div>
          <div className="mt-2 text-[10px] text-stone-600">
            Reason: {refund.reason}. {refund.restocked ? 'Items restocked.' : 'Items not restocked.'}
          </div>
        </>
      ) : (
        <>
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="font-mono">{moneyExact(sale.subtotalAmount, currency)}</span>
          </div>
          {sale.discountAmount > 0 && (
            <div className="flex justify-between">
              <span>Discount</span>
              <span className="font-mono">-{moneyExact(sale.discountAmount, currency)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-semibold mt-1 pt-1 border-t border-stone-300">
            <span>Total</span>
            <span className="font-mono">{moneyExact(sale.totalAmount, currency)}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span>Payment</span>
            <span>{sale.paymentMode}</span>
          </div>
          {sale.paymentMode === 'Cash' && sale.cashTendered !== undefined && (
            <>
              <div className="flex justify-between">
                <span>Cash received</span>
                <span className="font-mono">{moneyExact(sale.cashTendered, currency)}</span>
              </div>
              <div className="flex justify-between">
                <span>Change</span>
                <span className="font-mono">{moneyExact(sale.changeGiven ?? 0, currency)}</span>
              </div>
            </>
          )}
          {sale.mpesaDetails && (
            <>
              <div className="flex justify-between">
                <span>M-Pesa code</span>
                <span className="font-mono">{sale.mpesaDetails.transactionCode || 'Confirmed'}</span>
              </div>
              {sale.mpesaDetails.mode === 'stk' && (
                <div className="text-[10px] text-stone-500">Paid via Safaricom STK Push</div>
              )}
            </>
          )}
          {credit && (
            <>
              <div className="flex justify-between mt-1">
                <span>Credit balance</span>
                <span className="font-mono">
                  {moneyExact(Math.max(0, credit.totalAmount - credit.amountPaid), currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Due date</span>
                <span>{credit.dueDate}</span>
              </div>
            </>
          )}
        </>
      )}

      <div className="border-t border-dashed border-stone-300 my-3" />
      <p className="text-center text-[10px] whitespace-pre-line">{settings.receiptFooter}</p>
      {sale.status !== 'Completed' && !refund && (
        <p className="text-center text-[10px] font-semibold mt-1">Status: {sale.status}</p>
      )}
      <p className="text-center text-[9px] text-stone-400 mt-2">Thank you · Karibu tena</p>
    </div>
  );
};

export const ReceiptModal: React.FC<{
  open: boolean;
  onClose: () => void;
  sale: SaleTransaction;
  settings: StoreSettings;
  credit?: CreditRecord;
  refund?: RefundRecord;
}> = ({ open, onClose, sale, settings, credit, refund }) => (
  <Modal
    open={open}
    onClose={onClose}
    title={refund ? 'Refund receipt' : 'Receipt'}
    subtitle={refund ? refund.refundNo : `${sale.receiptNo} · ${dateTime(sale.createdAt)}`}
    size="sm"
    footer={
      <>
        <Button variant="secondary" onClick={onClose} className="no-print">
          Close
        </Button>
        <Button onClick={printReceipt} className="no-print">
          <Printer className="w-4 h-4" /> Print
        </Button>
      </>
    }
  >
    <ReceiptPaper sale={sale} settings={settings} credit={credit} refund={refund} />
  </Modal>
);

export { ReceiptPaper };
