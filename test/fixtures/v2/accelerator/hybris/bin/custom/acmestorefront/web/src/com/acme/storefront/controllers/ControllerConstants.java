package com.acme.storefront.controllers;

/**
 * Class with constants for controllers: view names and CMS action paths.
 */
public interface ControllerConstants
{
	interface Actions
	{
		interface Cms // NOSONAR
		{
			String _Prefix = "/view/"; // NOSONAR
			String _Suffix = "Controller"; // NOSONAR
			String ProductCarouselComponent = _Prefix + "ProductCarouselComponent" + _Suffix; // NOSONAR
		}
	}

	interface Views
	{
		interface Pages
		{
			interface Cart // NOSONAR
			{
				String CartPage = "pages/cart/cartPage"; // NOSONAR
			}
		}
	}
}
