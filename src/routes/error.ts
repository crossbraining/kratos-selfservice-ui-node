import { NextFunction, Request, Response } from 'express';
import config from '../config';
import { CommonApi, ErrorContainer } from '@oryd/kratos-client';
import { IncomingMessage } from 'http';

const commonApi = new CommonApi(config.kratos.admin);

export default async (req: Request, res: Response, next: NextFunction) => {
  try {
    // TODO:  <17-09-20, Vora, Deep> // test if this working fine
    const error = req.query.error;

    if (!error) {
      // No error was send, redirecting back to home.
      console.log(require('util').inspect(config.baseUrl, { depth: null, colors: true }));
      res.redirect(config.baseUrl);
      return;
    }

    const { body, response }: { body: ErrorContainer; response: IncomingMessage } = await commonApi.getSelfServiceError(
      error
    );
    if (response.statusCode == 404) {
      // The error could not be found, redirect back to home.
      res.redirect(config.baseUrl);
      return;
    }

    if ('errors' in body) {
      res.status(500).render('error', {
        message: JSON.stringify(body.errors, null, 2)
      });
      return Promise.resolve();
    }

    return Promise.reject(`expected body to contain "errors" but got ${JSON.stringify(body)}`);
  } catch (e) {
    /* handle error */
  }
};
