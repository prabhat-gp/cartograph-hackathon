package com.acme.core.voucher;

public interface VoucherDao
{
	VoucherModel findVoucher(String code);
}
