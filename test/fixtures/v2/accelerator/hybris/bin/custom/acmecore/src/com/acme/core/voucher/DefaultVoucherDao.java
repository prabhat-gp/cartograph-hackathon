package com.acme.core.voucher;

import de.hybris.platform.servicelayer.internal.dao.DefaultGenericDao;

public class DefaultVoucherDao extends DefaultGenericDao<VoucherModel> implements VoucherDao
{
	private static final String QUERY = "SELECT {pk} FROM {Voucher} WHERE {code} = ?code";

	@Override
	public VoucherModel findVoucher(final String code)
	{
		return getFlexibleSearchService().searchUnique(QUERY);
	}
}
