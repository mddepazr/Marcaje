import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Dialog
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && !loading) onCancel();
      }}
      width={440}
      purpose="required"
    >
      <VStack gap={4}>
        <DialogHeader
          title={title}
          onOpenChange={(isOpen) => {
            if (!isOpen && !loading) onCancel();
          }}
        />
        <Text type="body" color="secondary">
          {message}
        </Text>
        <HStack gap={2} hAlign="end">
          <Button
            label="Cancelar"
            variant="secondary"
            isDisabled={loading}
            onClick={onCancel}
          />
          <Button
            label={confirmLabel}
            variant={danger ? "destructive" : "primary"}
            isLoading={loading}
            onClick={onConfirm}
          />
        </HStack>
      </VStack>
    </Dialog>
  );
}
