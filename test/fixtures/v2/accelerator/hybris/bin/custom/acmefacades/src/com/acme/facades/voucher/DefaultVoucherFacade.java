package com.acme.facades.voucher;

import com.acme.core.voucher.VoucherService;

public class DefaultVoucherFacade implements VoucherFacade
{
	private VoucherService voucherService;

	@Override
	public void applyVoucher(final String code)
	{
		if (code == null) { throw new IllegalArgumentException("code"); }
		getVoucherService().redeemVoucher(code);
	}

	protected VoucherService getVoucherService()
	{
		return voucherService;
	}

	public void setVoucherService(final VoucherService voucherService)
	{
		this.voucherService = voucherService;
	}
}
