/**
 * Sample restaurant menu — DEMO DATA ONLY.
 *
 * Replace or extend this file (or load it from the backend) with real items.
 * All prices, names, descriptions and availability below are placeholder demo data.
 */

import { config } from './config';

export type ItemType = 'veg' | 'non-veg';

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  available: boolean;
  type?: ItemType;
}

export interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

export const MENU: MenuCategory[] = [
  {
    id: 'starters',
    name: 'Starters',
    items: [
      { id: 'item_paneer_tikka', name: 'Paneer Tikka', description: 'Grilled cottage cheese with Indian spices', price: 250, available: true, type: 'veg' },
      { id: 'item_honey_chilli_potato', name: 'Honey Chilli Potato', description: 'Crispy potatoes in honey-chilli glaze', price: 180, available: true, type: 'veg' },
      { id: 'item_chicken_wings', name: 'Crispy Chicken Wings', description: 'Spicy grilled chicken wings', price: 290, available: true, type: 'non-veg' },
    ],
  },
  {
    id: 'main_course',
    name: 'Main Course',
    items: [
      { id: 'item_paneer_butter_masala', name: 'Paneer Butter Masala', description: 'Cottage cheese in rich tomato gravy', price: 320, available: true, type: 'veg' },
      { id: 'item_veg_fried_rice', name: 'Veg Fried Rice', description: 'Wok-tossed rice with vegetables', price: 190, available: true, type: 'veg' },
      { id: 'item_chicken_biryani', name: 'Chicken Biryani', description: 'Fragrant basmati rice with chicken', price: 340, available: false, type: 'non-veg' },
      { id: 'item_butter_chicken', name: 'Butter Chicken', description: 'Tender chicken in buttery gravy', price: 360, available: true, type: 'non-veg' },
    ],
  },
  {
    id: 'rice_noodles',
    name: 'Rice and Noodles',
    items: [
      { id: 'item_hakka_noodles', name: 'Veg Hakka Noodles', description: 'Stir-fried noodles with vegetables', price: 170, available: true, type: 'veg' },
      { id: 'item_schezar_noodles', name: 'Schezwan Noodles', description: 'Spicy schezwan noodles', price: 190, available: true, type: 'veg' },
    ],
  },
  {
    id: 'beverages',
    name: 'Beverages',
    items: [
      { id: 'item_masala_chai', name: 'Masala Chai', description: 'Spiced Indian tea', price: 40, available: true, type: 'veg' },
      { id: 'item_mango_lassi', name: 'Mango Lassi', description: 'Chilled mango yogurt drink', price: 120, available: true, type: 'veg' },
      { id: 'item_fresh_lime_soda', name: 'Fresh Lime Soda', description: 'Lemon soda, sweet or salted', price: 60, available: true, type: 'veg' },
    ],
  },
  {
    id: 'desserts',
    name: 'Desserts',
    items: [
      { id: 'item_gulab_jamun', name: 'Gulab Jamun', description: 'Sweet milk-dumplings in sugar syrup', price: 90, available: true, type: 'veg' },
      { id: 'item_rasmalai', name: 'Rasmalai', description: 'Soft cheese cakes in sweetened milk', price: 110, available: true, type: 'veg' },
    ],
  },
];

export function categoryById(id: string): MenuCategory | undefined {
  return MENU.find((c) => c.id === id);
}

export function findItem(itemId: string): MenuItem | undefined {
  for (const category of MENU) {
    const item = category.items.find((i) => i.id === itemId);
    if (item) return item;
  }
  return undefined;
}

export function allItems(): MenuItem[] {
  return MENU.flatMap((c) => c.items);
}

export function formatPrice(price: number): string {
  return `${config.restaurant.currencySymbol}${price.toFixed(0)}`;
}

export function itemTypeLabel(item: MenuItem): string {
  if (item.type === 'veg') return 'Vegetarian';
  if (item.type === 'non-veg') return 'Non-vegetarian';
  return '';
}
