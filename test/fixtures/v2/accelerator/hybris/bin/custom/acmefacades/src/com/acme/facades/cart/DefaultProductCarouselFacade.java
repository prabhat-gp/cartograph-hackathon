package com.acme.facades.cart;

import java.util.List;

public class DefaultProductCarouselFacade implements ProductCarouselFacade
{
	@Override
	public List<ProductData> collectProducts(final ProductCarouselComponentModel component)
	{
		return component.getProducts();
	}
}
