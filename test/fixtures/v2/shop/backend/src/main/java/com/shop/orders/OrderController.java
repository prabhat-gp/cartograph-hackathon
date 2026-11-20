package com.shop.orders;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @GetMapping("/{id}")
    public OrderDto getOrder(@PathVariable String id) {
        return orderService.find(id);
    }

    @PostMapping
    public OrderDto place(@RequestBody OrderDto order) {
        return orderService.place(order);
    }
}
