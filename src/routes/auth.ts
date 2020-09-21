import { NextFunction, Request, Response } from 'express';
import config from '../config';
import { sortFormFields } from '../translations';
import { isString } from '../helpers';
import { AdminApi, FormField, LoginRequest, RegistrationRequest } from '@oryd/kratos-client';
import { IncomingMessage } from 'http';

// A simple express handler that shows the login / registration screen.
// Argument "type" can either be "login" or "registration" and will
// fetch the form data from ORY Kratos's Public API.
const kratos = new AdminApi(config.kratos.admin);

export const authHandler = (type: 'login' | 'registration') => async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const request = req.query.request;

    // The request is used to identify the login and registration request and
    // return data like the csrf_token and so on.
    if (!request || !isString(request)) {
      console.log('No request found in URL, initializing auth flow.');
      res.redirect(`${config.kratos.browser}/self-service/browser/flows/${type}`);
      return;
    }

    const authRequest: Promise<{
      response: IncomingMessage;
      body?: LoginRequest | RegistrationRequest;
    }> =
      type === 'login'
        ? kratos.getSelfServiceBrowserLoginRequest(request)
        : kratos.getSelfServiceBrowserRegistrationRequest(request);

    const {
      body,
      response
    }: { body?: LoginRequest | RegistrationRequest; response: IncomingMessage } = await authRequest;

    if (response.statusCode == 404 || response.statusCode == 410 || response.statusCode == 403) {
      res.redirect(`${config.kratos.browser}/self-service/browser/flows/${type}`);
      return;
    } else if (response.statusCode != 200) {
      throw new Error(JSON.stringify(body));
    }

    if (!body) {
      res.redirect(`${config.kratos.browser}/self-service/browser/flows/${type}`);
      return;
    }

    if (body.methods.password.config?.fields) {
      // We want the form fields to be sorted so that the email address is first, the
      // password second, and so on.
      body.methods.password.config.fields = body.methods.password.config.fields.sort(sortFormFields);
    }

    // This helper returns a request method config (e.g. for the password flow).
    // If active is set and not the given request method key, it wil be omitted.
    // This prevents the user from e.g. signing up with email but still seeing
    // other sign up form elements when an input is incorrect.
    const methodConfig = (key: string) => {
      if (body?.active === key || !body?.active) {
        return body?.methods[key]?.config;
      }
    };

    let hydra = false;
    if (body.requestUrl.indexOf('hydra=true') !== -1) {
      hydra = true;
    }

    res.render(type, {
      ...body,
      hydra,
      oidc: methodConfig('oidc'),
      password: methodConfig('password')
    });
  } catch (e) {
    console.error(e);
    next(e);
  }
};
