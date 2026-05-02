/* eslint-disable require-jsdoc, valid-jsdoc */
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Text,
} from "@react-email/components";

const buttonStyle = {
  backgroundColor: "#0070f3",
  color: "#ffffff",
  padding: "12px 20px",
  borderRadius: "6px",
  textDecoration: "none",
  fontWeight: "bold",
  display: "inline-block",
};

const containerStyle = {
  margin: "0 auto",
  padding: "20px",
  maxWidth: "560px",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

const linkStyle = {color: "#0070f3", wordBreak: "break-all" as const};

const footerStyle = {fontSize: "12px", color: "#666666"};

export interface InvitationEmailProps {
  ownerName: string;
  ownerEmail: string;
  modelName: string;
  tokenId: string;
  expirationDays: number;
}

export function InvitationEmail({
  ownerName,
  ownerEmail,
  modelName,
  tokenId,
  expirationDays,
}: InvitationEmailProps) {
  const url = `https://ahp.spertsuite.com/?invite=${tokenId}`;
  return (
    <Html>
      <Head />
      <Body>
        <Container style={containerStyle}>
          <Heading>{ownerName} invited you to a SPERT AHP project</Heading>
          <Text>
            {ownerName} ({ownerEmail}) added you as a collaborator on
            &quot;{modelName}&quot;.
          </Text>
          <Button style={buttonStyle} href={url}>Open SPERT AHP</Button>
          <Text>
            <a href={url} style={linkStyle}>{url}</a>
          </Text>
          <Hr />
          <Text style={footerStyle}>
            This invitation expires in {expirationDays} days. To ask{" "}
            {ownerName} a question about it, just reply to this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export interface AddedNotificationEmailProps {
  ownerName: string;
  ownerEmail: string;
  modelName: string;
  role: "editor" | "viewer";
}

export function AddedNotificationEmail({
  ownerName,
  ownerEmail,
  modelName,
  role,
}: AddedNotificationEmailProps) {
  const url = "https://ahp.spertsuite.com/";
  return (
    <Html>
      <Head />
      <Body>
        <Container style={containerStyle}>
          <Heading>You&apos;ve been added to a SPERT AHP project</Heading>
          <Text>
            {ownerName} ({ownerEmail}) added you as a {role} on
            &quot;{modelName}&quot;. Open SPERT AHP to participate.
          </Text>
          <Button style={buttonStyle} href={url}>Open SPERT AHP</Button>
          <Text>
            <a href={url} style={linkStyle}>{url}</a>
          </Text>
          <Hr />
          <Text style={footerStyle}>
            Reply to this email to ask {ownerName} a question.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
