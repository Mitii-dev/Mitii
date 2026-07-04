import { Router } from 'express';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import supertest from 'supertest';

// Create a minimal test server to verify current behavior
const router = Router();

router.get('/', (_req, res) => {
  // This is what the task says the bug is - but let's see what we actually have
  res.json({ users: [] });
});

// For testing purposes, we'll create a simple server
const express = (await import('express')).default;
const app = express();
app.use('/users', router);

async function testEndpoint() {
  const request = supertest(app);
  try {
    const response = await request.get('/users/');
    console.log('Response status:', response.status);
    console.log('Response body:', response.body);
    return response.body;
  } catch (error) {
    console.error('Error:', error);
  }
}

testEndpoint();