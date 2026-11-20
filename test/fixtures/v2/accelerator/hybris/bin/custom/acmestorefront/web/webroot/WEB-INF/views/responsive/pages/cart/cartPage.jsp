<%@ page trimDirectiveWhitespaces="true" %>
<%@ taglib prefix="template" tagdir="/WEB-INF/tags/responsive/template" %>
<%@ taglib prefix="cart" tagdir="/WEB-INF/tags/responsive/cart" %>
<%@ taglib prefix="cms" uri="http://hybris.com/tld/cmstags" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%-- <cart:ignored/> inside a JSP comment --%>
<template:page pageTitle="${pageTitle}">
	<cms:pageSlot position="TopContent" var="feature">
		<cms:component component="${feature}"/>
	</cms:pageSlot>
	<cart:cartItems cartData="${cartData}"/>
	<c:url value="/cart/voucher/apply" var="applyVoucherUrl"/>
	<form action="/cart/voucher/apply" method="post">
		<input name="voucherCode"/>
	</form>
</template:page>
