const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
});

// 1. Configuración de CORS
app.use(cors());

// 2. Webhook de Stripe
// IMPORTANTE: Debe ir antes de express.json() para procesar el body raw y verificar la firma
app.post(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error(`Error en firma de Webhook: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Procesamiento de eventos de facturación y pago
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        console.log(`Pago recibido para Intent: ${paymentIntent.id}`);
        
        // Actualizar estado en la base de datos
        await prisma.invoice.updateMany({
          where: { stripePaymentIntentId: paymentIntent.id },
          data: { status: 'PAID' },
        }).catch((err) => console.error('Error actualizando estado:', err));
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        console.log(`Factura pagada exitosamente: ${invoice.id}`);
        break;
      }
      default:
        console.log(`Evento sin controlador explícito: ${event.type}`);
    }

    res.json({ received: true });
  }
);

// 3. Middlewares para parseo de JSON y formularios
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. Servidor de archivos estáticos (Frontend / Public)
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// RUTAS DE FACTURACIÓN Y TRANSACCIONES
// -------------------------------------------------------------

// Crear intención de pago / Registro de factura
app.post('/api/invoices/create', async (req, res) => {
  try {
    const { amount, currency = 'usd', customerId, description, items } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'El monto de la factura es requerido y debe ser mayor a 0.' 
      });
    }

    // Crear Intent en Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(amount) * 100), // En centavos
      currency: currency.toLowerCase(),
      description: description || 'Factura de servicio',
      metadata: { customerId: customerId || 'guest' },
    });

    // Guardar registro en la base de datos con Prisma
    const invoice = await prisma.invoice.create({
      data: {
        stripePaymentIntentId: paymentIntent.id,
        amount: parseFloat(amount),
        currency: currency.toUpperCase(),
        status: 'PENDING',
        description: description || '',
      },
    });

    return res.status(201).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      invoice,
    });
  } catch (error) {
    console.error('Error al registrar factura:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno al procesar la factura.',
      details: error.message,
    });
  }
});

// Listar todas las facturas
app.get('/api/invoices', async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ success: true, data: invoices });
  } catch (error) {
    console.error('Error al obtener facturas:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Error al consultar facturas en la base de datos.' 
    });
  }
});

// 5. Captura genérica (Fallback para Single Page Application)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 6. Manejo global de errores
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err.stack);
  res.status(500).json({ 
    success: false, 
    error: 'Ocurrió un error inesperado en el servidor.' 
  });
});

// 7. Arranque del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor Express corriendo en el puerto ${PORT}`);
});
