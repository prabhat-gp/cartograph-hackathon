package com.acme.core.voucher;

public class DefaultVoucherService implements VoucherService
{
	private VoucherDao voucherDao;

	@Override
	public void redeemVoucher(final String code)
	{
		final VoucherModel voucher = voucherDao.findVoucher(code);
		voucher.setRedeemed(true);
	}

	public void setVoucherDao(final VoucherDao voucherDao)
	{
		this.voucherDao = voucherDao;
	}
}
