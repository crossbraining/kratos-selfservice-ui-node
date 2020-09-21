import { NextFunction, Request, Response } from 'express';
import config from '../config';
import { CommonApi } from '@oryd/kratos-client';
import { IncomingMessage } from 'http';

const kratos = new CommonApi(config.kratos.admin);

export default async (req: Request, res: Response, next: NextFunction) => {
  try {
    const request = req.query.request;

    // The request is used to identify the login and registration request and
    // return data like the csrf_token and so on.
    if (!request) {
      console.log('No request found in URL, initializing verify flow.');
      res.redirect(`${config.kratos.browser}/self-service/browser/flows/verification/email`);
      return;
    }

    const {
      body,
      response
    }: { response: IncomingMessage; body?: any } = await kratos.getSelfServiceVerificationRequest(request);
    if (response.statusCode == 404) {
      res.redirect(`${config.kratos.browser}/self-service/browser/flows/verification/email`);
      return;
    } else if (response.statusCode != 200) {
      throw new Error(body);
    }

    res.render('verification', body);
  } catch (e) {
    next(e);
  }
};
