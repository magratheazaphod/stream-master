import { SignInForm } from './SignInForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Sign in - stream-master',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  // Only take a same-site path back. An absolute URL in a query string is how a
  // sign-in form becomes somebody else's open redirect.
  const next = from && from.startsWith('/') && !from.startsWith('//') ? from : '/';
  return <SignInForm next={next} />;
}
