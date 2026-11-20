package com.acme.facades.cart;

import java.util.List;

public interface ProductCarouselFacade
{
	List<ProductData> collectProducts(ProductCarouselComponentModel component);
}
