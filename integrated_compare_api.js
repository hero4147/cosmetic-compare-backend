// Integrated API with DB product merge, caching (Node.js + Express + MongoDB)

import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import mongoose from 'mongoose';

const app = express();
const port = process.env.PORT || 3002;
const cache = new Map();

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/cosmeticdb', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const ProductSchema = new mongoose.Schema({
  name: String,
  ingredients: [String],
  price: Number,
  weight: Number,
  link: String,
  createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', ProductSchema);

async function fetchIngredientsFromIncidecoder(productName) {
  try {
    const query = encodeURIComponent(productName);
    const searchURL = `https://incidecoder.com/search?query=${query}`;
    const searchRes = await axios.get(searchURL);
    const $ = cheerio.load(searchRes.data);
    const productLink = $('a.card-link').first().attr('href');
    if (!productLink) return [];
    const productURL = `https://incidecoder.com${productLink}`;
    const productRes = await axios.get(productURL);
    const $$ = cheerio.load(productRes.data);
    const ingredients = [];
    $$('.component-list li .component-name').each((_, el) => {
      ingredients.push($$(el).text().trim());
    });
    return ingredients;
  } catch (error) {
    console.error('INCIDecoder error:', error);
    return [];
  }
}

async function fetchCoupangPrices(keyword) {
  try {
    const encodedKeyword = encodeURIComponent(keyword);
    const url = `https://www.coupang.com/np/search?q=${encodedKeyword}`;
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    const response = await axios.get(url, { headers });
    const $ = cheerio.load(response.data);
    const results = [];
    $('ul.search-product-list li.search-product').each((i, el) => {
      const name = $(el).find('div.name').text().trim();
      const priceText = $(el).find('strong.price-value').first().text().replace(/,/g, '');
      const price = parseInt(priceText, 10);
      const link = 'https://www.coupang.com' + $(el).find('a.search-product-link').attr('href');
      if (name && price && link) {
        results.push({ name, price, link });
      }
    });
    return results;
  } catch (error) {
    console.error('Coupang error:', error);
    return [];
  }
}

app.get('/api/full-compare', async (req, res) => {
  const productName = req.query.product;
  if (!productName) return res.status(400).send('Product name required');

  if (cache.has(productName)) {
    console.log('Using cached result');
    return res.json(cache.get(productName));
  }

  const [ingredients, prices, dbProducts] = await Promise.all([
    fetchIngredientsFromIncidecoder(productName),
    fetchCoupangPrices(productName),
    Product.find({})
  ]);

  const dbResults = dbProducts.map(p => ({
    name: p.name,
    price: p.price,
    pricePerGram: (p.price / p.weight).toFixed(1),
    ingredients: p.ingredients,
    link: p.link
  }));

  const result = {
    product: productName,
    ingredients,
    prices: [...prices, ...dbResults]
  };

  cache.set(productName, result);
  return res.json(result);
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
