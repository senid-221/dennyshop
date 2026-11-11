/* ============================================================
   Shop settings - the only file you need to edit before publishing.
   Everything here is plain data; keep the var keyword so the other
   scripts can read it.
   ============================================================ */

var SHOP = {
    name: "Denny Shop",
    tagline: "Quality fashion delivered in Rwanda",
    city: "Muhanga",
    country: "Rwanda",
    addressLine: "Muhanga - Rwanda",
    phoneDisplay: "+250 836 00 961",
    // WhatsApp recipient in international format, digits only.
    whatsappNumber: "25083600961",
    email: "info@dennyshop.com",
    mapLat: -2.0299,
    mapLng: 29.7164
};

var MOMO = {
    // Money goes here. Confirm this is the live MoMo number before publishing.
    merchantNumber: "083600961",
    merchantName: "DENNY SHOP",
    network: "MTN MoMo",
    // Optional: if you know the MoMo menu short code, set it, e.g. "*182#".
    // Left empty on purpose so no wrong code is ever shown to a customer.
    ussdCode: "",
    refLabel: "MoMo Transaction ID",
    refHint: "You get it in the MoMo SMS confirmation after payment."
};

var MONEY = {
    currency: "RWF",
    roundTo: 100
};

var DELIVERY = {
    freeOver: 200000,
    zones: [
        { name: "Muhanga", fee: 1500 },
        { name: "Kigali City", fee: 2000 },
        { name: "Other district", fee: 3500 }
    ]
};

/* The catalogue. img paths are relative to the site folder.
   price is in RWF. category: men | women */
var PRODUCTS = [
    { id: "p1",  name: "Men's Shirt",   category: "men",   price: 97500,  img: "images/p1.png",  sizes: ["S", "M", "L", "XL"], colors: ["White", "Blue"], badge: "New" },
    { id: "p2",  name: "Men's Shirt",   category: "men",   price: 104000, img: "images/p2.png",  sizes: ["S", "M", "L", "XL"], colors: ["Black", "Grey"], badge: "" },
    { id: "p3",  name: "Women's Dress", category: "women", price: 88500,  img: "images/p3.png",  sizes: ["S", "M", "L"],       colors: ["Red", "Navy"], badge: "Sale" },
    { id: "p4",  name: "Women's Dress", category: "women", price: 91000,  img: "images/p4.png",  sizes: ["S", "M", "L"],       colors: ["Pink", "Cream"], badge: "" },
    { id: "p5",  name: "Women's Dress", category: "women", price: 97500,  img: "images/p5.png",  sizes: ["XS", "S", "M", "L"], colors: ["Black"], badge: "" },
    { id: "p6",  name: "Women's Dress", category: "women", price: 75500,  img: "images/p6.png",  sizes: ["S", "M", "L"],       colors: ["White", "Green"], badge: "Sale" },
    { id: "p7",  name: "Women's Dress", category: "women", price: 104000, img: "images/p7.png",  sizes: ["S", "M", "L", "XL"], colors: ["Blue"], badge: "New" },
    { id: "p8",  name: "Men's Shirt",   category: "men",   price: 84500,  img: "images/p8.png",  sizes: ["M", "L", "XL"],      colors: ["Striped"], badge: "" },
    { id: "p9",  name: "Men's Shirt",   category: "men",   price: 84500,  img: "images/p9.png",  sizes: ["S", "M", "L"],       colors: ["Navy", "White"], badge: "" },
    { id: "p10", name: "Men's Shirt",   category: "men",   price: 84500,  img: "images/p10.png", sizes: ["S", "M", "L", "XL"], colors: ["Black"], badge: "" },
    { id: "p11", name: "Men's Shirt",   category: "men",   price: 84500,  img: "images/p11.png", sizes: ["S", "M", "L"],       colors: ["Khaki"], badge: "" },
    { id: "p12", name: "Women's Dress", category: "women", price: 84500,  img: "images/p12.png", sizes: ["XS", "S", "M", "L"], colors: ["Yellow", "Red"], badge: "New" }
];

var CATEGORIES = [
    { key: "all", label: "All" },
    { key: "men", label: "Men" },
    { key: "women", label: "Women" }
];
