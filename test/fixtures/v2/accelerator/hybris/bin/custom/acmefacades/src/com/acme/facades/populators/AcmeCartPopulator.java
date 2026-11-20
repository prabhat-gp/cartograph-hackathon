package com.acme.facades.populators;

import de.hybris.platform.converters.Populator;

public class AcmeCartPopulator implements Populator<CartModel, CartData>
{
	@Override
	public void populate(final CartModel source, final CartData target)
	{
		target.setLoyaltyPoints(source.getLoyaltyPoints());
	}
}
