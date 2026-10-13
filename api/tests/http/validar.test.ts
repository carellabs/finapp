import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { validarBody, validarParams, validarQuery } from '../../src/http/validar';

const ESQUEMA = z.object({ nombre: z.string().min(1) });

function crearRequest(datos: unknown): Request {
  return { body: datos, query: datos, params: datos } as unknown as Request;
}

describe('validarBody', () => {
  it('con datos válidos, sustituye req.body por el dato parseado y llama a next() sin error', () => {
    const req = crearRequest({ nombre: 'Fabrizio' });
    const next = vi.fn() as NextFunction;

    validarBody(ESQUEMA)(req, {} as Response, next);

    expect(req.body).toEqual({ nombre: 'Fabrizio' });
    expect(next).toHaveBeenCalledWith();
  });

  it('con datos inválidos, llama a next(error) con status 422 y detalles campo+motivo', () => {
    const req = crearRequest({ nombre: '' });
    const next = vi.fn() as NextFunction;

    validarBody(ESQUEMA)(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      status: number;
      detalles: Array<{ campo: string; motivo: string }>;
    };
    expect(error.status).toBe(422);
    expect(error.detalles[0]?.campo).toBe('nombre');
  });

  it('rechaza un body completamente ajeno al schema (no revienta)', () => {
    const req = crearRequest({ otraCosa: 123 });
    const next = vi.fn() as NextFunction;

    validarBody(ESQUEMA)(req, {} as Response, next);

    const error = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { status: number };
    expect(error.status).toBe(422);
  });
});

describe('validarQuery', () => {
  it('con datos válidos, sustituye req.query y no produce error', () => {
    const req = crearRequest({ nombre: 'ok' });
    const next = vi.fn() as NextFunction;

    validarQuery(ESQUEMA)(req, {} as Response, next);

    expect(req.query).toEqual({ nombre: 'ok' });
    expect(next).toHaveBeenCalledWith();
  });

  it('con datos inválidos, produce un error 422', () => {
    const req = crearRequest({});
    const next = vi.fn() as NextFunction;

    validarQuery(ESQUEMA)(req, {} as Response, next);

    const error = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { status: number };
    expect(error.status).toBe(422);
  });
});

describe('validarParams', () => {
  it('con datos válidos, sustituye req.params y no produce error', () => {
    const req = crearRequest({ nombre: 'ok' });
    const next = vi.fn() as NextFunction;

    validarParams(ESQUEMA)(req, {} as Response, next);

    expect(req.params).toEqual({ nombre: 'ok' });
    expect(next).toHaveBeenCalledWith();
  });

  it('con datos inválidos, produce un error 422', () => {
    const req = crearRequest({});
    const next = vi.fn() as NextFunction;

    validarParams(ESQUEMA)(req, {} as Response, next);

    const error = (next as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { status: number };
    expect(error.status).toBe(422);
  });
});
