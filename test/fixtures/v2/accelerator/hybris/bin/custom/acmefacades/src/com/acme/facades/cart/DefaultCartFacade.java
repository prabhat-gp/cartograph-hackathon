package com.acme.facades.cart;

import de.hybris.platform.converters.Converter;

public class DefaultCartFacade implements CartFacade
{
	private Converter<CartModel, CartData> cartConverter;

	@Override
	public CartData getSessionCart()
	{
		return getCartConverter().convert(null);
	}

	protected Converter<CartModel, CartData> getCartConverter()
	{
		return cartConverter;
	}

	public void setCartConverter(final Converter<CartModel, CartData> cartConverter)
	{
		this.cartConverter = cartConverter;
	}
}
